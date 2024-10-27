#version 150

struct Ray {
  vec3 pos;
  vec3 dir;
};

struct Material {
  vec4 albedo;
  vec4 emission_colour;
  float emission_strength;
  float specular_chance;
  float specular_roughness;
  float specular_fuzz;
  vec4 specular_colour;
  vec4 refraction_colour;
  float ior;
  float refraction_chance;
  float refraction_roughness;
  float f0;
  float f90;
};

struct Hit {
  bool did_hit;
  vec3 pos;
  vec3 normal;
  float dist;
  bool front_face;
  Material material;
};

struct Sphere {
  Material material;
  vec4 pos;
  float radius;
};

// Shader parameters ----------------------------------------------------------

in vec2 out_tex_coord;
out vec4 out_colour;

// Screen parameters
uniform uvec2 SCREEN_RESOLUTION;
uniform float ASPECT_RATIO;
uniform int FRAME;  // Frame number, used for rng seed and averaging frames
uniform sampler2D prev_frame;


// Uniforms for storing objects that rays can interact with
uniform int NUM_SPHERES;
layout (std140) uniform SphereBlock {
  Sphere spheres[10];
};

// Parameters for camera
uniform vec3 CAM_POS;
uniform vec3 CAM_FORWARD;
uniform vec3 CAM_UP;
uniform vec3 CAM_RIGHT;
uniform float VFOV;
uniform float DEFOCUS_ANGLE;
uniform float FOCUS_DIST;
uniform float EXPOSURE;

// Parameters for rays
uniform int SAMPLES_PER_PIXEL;
uniform int MAX_BOUNCE_COUNT;

// Functions for randomness ---------------------------------------------------
uint wang_hash(inout uint rng_state) {
  rng_state = uint(rng_state ^ uint(61)) ^ uint(rng_state >> uint(16));
  rng_state *= uint(9);
  rng_state = rng_state ^ (rng_state >> 4);
  rng_state *= uint(0x27d4eb2d);
  rng_state = rng_state ^ (rng_state >> 15);
  return rng_state;
}

// Returns random float in the range [0, 1]
float random_float(inout uint state) {
  return float(wang_hash(state)) / 4294967296.0;
}

// Returns a random float in the range [0, 1] using a normal distribution
float random_float_normal_distribution(inout uint rng_state) {
  float theta = 2.0 * 3.141592654 * random_float(rng_state);
  float rho = sqrt(-2.0 * log(random_float(rng_state)));
  return rho * cos(theta);
}

vec3 random_direction(inout uint rng_state) {
  float x = random_float_normal_distribution(rng_state);
  float y = random_float_normal_distribution(rng_state);
  float z = random_float_normal_distribution(rng_state);
  return normalize(vec3(x, y, z));
 }

vec3 random_hemisphere_direction(vec3 normal, inout uint rng_state) {
  vec3 dir = random_direction(rng_state);
  return dir * sign(dot(normal, dir));
}

// Returns random point on unit square
vec2 sample_square(inout uint rng_state) {
  return vec2(random_float(rng_state)-0.5, random_float(rng_state)-0.5);
}

// Returns random point on unit circle
vec2 sample_circle(inout uint rng_state) {
  float angle = random_float(rng_state) * 2.0 * 3.141592654; 
  vec2 point_on_circle = vec2(cos(angle), sin(angle));
  return point_on_circle * sqrt(random_float(rng_state));
}


// Functions for colour correction --------------------------------------------
vec3 less_than(vec3 v, float value) {
  return vec3(
    float(v.x < value),
    float(v.y < value),
    float(v.z < value)
  );
}

vec3 linear_to_srgb(vec3 rgb) {
  rgb = clamp(rgb, vec3(0.0), vec3(1.0));  
  return mix(
    pow(rgb, vec3(1.0/2.4)) * 1.055 - 0.055,
    rgb * 12.92,
    less_than(rgb, 0.0031308)
  );
}

vec3 srgb_to_linear(vec3 rgb) {
  rgb = clamp(rgb, vec3(0.0), vec3(1.0));  
  return mix(
    pow(((rgb+0.055) / 1.055), vec3(2.4)),
    rgb / 12.92,
    less_than(rgb, 0.04045)
  );
}

// Tone maps an HDR colour to LDR according to a luminance only fit
// Code made by Krzysztof Narkowicz
vec3 aces_film(vec3 hdr) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((hdr*(a*hdr + b)) / (hdr*(c*hdr + d) + e), 0.0, 1.0);
}

// Functions for creating rays and handling their collisions ------------------

// Creates a ray originating from a defocus disk around the camera position,
// directed toward a randomly jittered sample around the viewport pixel position 
// for this fragmet.
Ray get_ray_sample(vec3 pixel_down_left, vec3 pixel_delta_u, vec3 pixel_delta_v,
vec3 defocus_u, vec3 defocus_v, inout uint rng_state) {
  vec3 ij = vec3(out_tex_coord * vec2(SCREEN_RESOLUTION), 0.0); // Pixel indices

  // Add some jittering for anti-aliasing
  vec3 jittered_ij = ij + vec3(sample_square(rng_state), 0.0);
  vec3 pixel_world_pos = pixel_down_left + jittered_ij.x * pixel_delta_u + jittered_ij.y * pixel_delta_v;

  vec2 p = sample_circle(rng_state);

  Ray ray;
  ray.pos = CAM_POS + p.x*defocus_u + p.y*defocus_v;
  ray.dir = normalize(pixel_world_pos-ray.pos);
  return ray;
}

// Gets the background colour for a ray that does not hit any objects
vec3 get_background_light(Ray ray) {
  // Calculate a background colour as a nice white to blue gradient along y
  float a = 0.5*(normalize(ray.dir).y+1.0);
  return (1.0-a)*vec3(1.0, 1.0, 1.0)+a*vec3(0.5,0.7,1.0);
}

// Calculates whether a given ray intersects with a given sphere
Hit ray_sphere_intersect(Ray ray, Sphere sphere) {
  Hit hit;
  hit.did_hit = false;

  // Sphere equation: dot(offs, offs) - r^2 = 0,
  // offs = sphere.center - ray.dir * t 
  // Rewritten as quadratic equation in t with coefficients a, b, c
  // Ignore the w component of sphere.pos as it is used just for byte alignment
  //vec3 offs = sphere.pos.xyz-ray.pos;
  vec3 offs = sphere.pos.xyz - ray.pos;
  float a = dot(ray.dir, ray.dir);
  float b = -2.0 * dot(ray.dir, offs);
  float c = dot(offs, offs) - sphere.radius*sphere.radius;

  // Discriminant of quadratic equation gives number of solutions i.e. num hits 
  // negative = no hit, 0 = 1 hit on edge, positive = 2 hits through sphere
  float discriminant = b * b - 4.0 * a * c;
  if (discriminant >= 0) {

    // 0.001 dist threshold rather than 0.0 is to combat shadow acne caused by 
    // floating point inaccuracy
    float sqrtd = sqrt(discriminant);
    bool front_face = true;
    float dist = (-b-sqrtd) / (2.0 * a);
    if (dist <= -0.001) {
      dist = (-b+sqrtd) / (2.0 * a);
      front_face = false;
    }
    if (dist >= 0.001) {
      hit.did_hit = true;
      hit.pos = ray.pos + ray.dir * dist; 
      //hit.normal = normalize(hit.pos - sphere.pos.xyz); // Outward pointing normals
      hit.normal = normalize(hit.pos - sphere.pos.xyz) * (front_face ? 1.0 : -1.0);
      hit.dist = dist;
      hit.material = sphere.material;
      //hit.front_face = dot(ray.dir, hit.normal) <= 0.0;
      hit.front_face = front_face;
    }
  }
  return hit;
}

Hit ray_collision(Ray ray) {
    Hit closest_hit;
    closest_hit.did_hit = false;
    closest_hit.dist = 9999999999.0;
    for (int i = 0; i < NUM_SPHERES; i++) {
      Hit hit = ray_sphere_intersect(ray, spheres[i]);
      if (hit.did_hit && hit.dist < closest_hit.dist) {
        closest_hit = hit;
      }
    }
    return closest_hit;
}


// The actual ray tracing -----------------------------------------------------
float reflectance(float cos_theta, float refraction_index) {
  float r0 = (1.0 - refraction_index) / (1.0 + refraction_index);
  r0 = r0*r0;
  return r0 + (1.0-r0) * pow(1.0-cos_theta, 5.0);
}

float fresnel_reflectance(float ior_outer, float ior_inner, vec3 n, vec3 ray_dir, float f0, float f90) {
  float r0 = (ior_outer - ior_inner) / (ior_outer + ior_inner);
  r0 *= r0;
  float cos_x = -dot(n, ray_dir);
  if (ior_outer > ior_inner) {
    float ior = ior_outer / ior_inner;
    float sin_t2 = ior * ior * (1.0 - cos_x*cos_x);

    if (sin_t2 > 1.0) {
      return f90;
    }
    cos_x = sqrt(1.0-sin_t2);
  }
  float x = 1.0-cos_x;
  float ret = r0 + (1.0-r0) * x*x*x*x*x;
  return mix(f0, f90, ret);
}

// Returns the incoming light from this ray
vec3 trace(Ray ray, inout uint rng_state) {
  vec3 incoming_light = vec3(0.0);
  vec3 ray_colour = vec3(1.0);

  for (int b = 0; b < MAX_BOUNCE_COUNT; b++) {
    Hit hit = ray_collision(ray);

    if (hit.did_hit) {
      ray.pos = hit.pos;
      Material material = hit.material;

      // Absorption when the ray hits inside an object
      // Uses Beer's law
      if (!hit.front_face) {
        ray_colour *= exp(-material.refraction_colour.xyz * hit.dist);
      }

      // Calculate chances for a diffuse bounce, specular bounce or refraction
      float specular_chance = material.specular_chance;
      float refraction_chance = material.refraction_chance;
      float ray_probability = 1.0;
      if (specular_chance > 0.0) {
        specular_chance = fresnel_reflectance(
          // mix(material.ior_outer, material.ior_inner, float(!hit.front_face)),
          // mix(material.ior_outer, material.ior_inner, float(hit.front_face)),
          mix(material.ior, 1.0, float(hit.front_face)),
          mix(material.ior, 1.0, float(!hit.front_face)),
          hit.normal,
          ray.dir,
          material.specular_chance,
          material.f90
        );
        float chance_multiplier = (1.0-specular_chance) / (1.0 - material.specular_chance);
        refraction_chance *= chance_multiplier;
      }

      // Choose which type of bounce to do for the ray
      float do_specular = 0.0;
      float do_refraction = 0.0;
      float rng_roll = random_float(rng_state);
      if (specular_chance > 0.0 && rng_roll < specular_chance) {
        do_specular = 1.0;
        ray_probability = specular_chance;
      }
      else if (refraction_chance > 0.0 && rng_roll < specular_chance + refraction_chance) {
        do_refraction = 1.0;
        ray_probability = refraction_chance;
      }
      else {
        ray_probability = 1.0 - specular_chance - refraction_chance;
      }

      // Avoid divide by zero
      ray_probability = max(ray_probability, 0.001);

      // Nudge the ray position slightly along the surface normal to avoid 
      // incorrect intersections when the ray bounces
      if (do_refraction == 1.0) {
        ray.pos -= hit.normal * 0.01;
      }
      else {
        ray.pos += hit.normal * 0.01;
      }

      // Calculate ray direction for a diffuse bounce
      vec3 diffuse_dir = normalize(hit.normal + random_direction(rng_state));

      // Calculate ray direction for reflection bounce -> specularity
      vec3 specular_fuzz = material.specular_fuzz * random_direction(rng_state);
      vec3 specular_dir = normalize(reflect(ray.dir, hit.normal) + specular_fuzz);
      specular_dir = normalize(mix(specular_dir, diffuse_dir, material.specular_roughness * material.specular_roughness));

      // Calculate ray direction for refraction (-> transparency)
      // float r_i = material.ior_outer / material.ior_inner;
      // r_i = mix(1.0/r_i, r_i, float(hit.front_face));
      float r_i = mix(material.ior, 1.0/material.ior, float(hit.front_face));
      vec3 refract_dir = refract(ray.dir, hit.normal, r_i);
      vec3 refraction_fuzz = normalize(-hit.normal + random_direction(rng_state));
      refract_dir = normalize(mix(refract_dir, refraction_fuzz, material.refraction_roughness*material.refraction_roughness));

      // Set the ray direction depending on bounce type
      ray.dir = mix(diffuse_dir, specular_dir, do_specular);
      ray.dir = mix(ray.dir, refract_dir, do_refraction);

      // Try to catch bad ray directions that would lead to NaN or infinity
      float tol = 0.000001;
      if (abs(ray.dir.x) < tol && abs(ray.dir.y) < tol && abs(ray.dir.z) < tol) {
        ray.dir = hit.normal;
      }

      // Update light, discard the w component of the vec4 material colours 
      // as it is only used for proper byte aligment
      vec3 emitted_light = material.emission_colour.xyz * material.emission_strength;
      incoming_light += emitted_light * ray_colour;

      // Ray colour is only affected by refraction when hitting the next face 
      // This is to be able to do absorption over distance within an object
      if (do_refraction == 0.0) {
        ray_colour *= mix(material.albedo.xyz, material.specular_colour.xyz, do_specular);
      }

      ray_colour /= ray_probability;

      // Random early termination of rays for better performance
      float p = max(ray_colour.x, max(ray_colour.y, ray_colour.z));
      if (random_float(rng_state) > p) break;

      // Make up for 'energy loss' from early termination 
      ray_colour *= 1.0/max(p, 0.001);
    }
    else {
      // Ray bounced off into the sky/void
      incoming_light += get_background_light(ray) * ray_colour;
      break;
    }
  }

  return incoming_light;
}

void main(void) {
  // Generate a seed for rng using the view position and frame number
  // This gives each fragment an own unique rng seed that changes every frame
  uvec2 pixel_coord = uvec2(out_tex_coord * vec2(SCREEN_RESOLUTION));
  uint pixel_index = pixel_coord.y * SCREEN_RESOLUTION.x + pixel_coord.x;
  uint rng_state = pixel_index + uint(FRAME) * uint(719393);

  // Calculate viewport dimensions depending on FOV and aspect ratio
  float fov_angle_rad = VFOV * 3.141592654 / 180.0;
  float h = tan(fov_angle_rad / 2.0);
  float v_height = 2.0 * h * FOCUS_DIST;
  float v_width = v_height * ASPECT_RATIO;

  // Calculate veiwport edges
  vec3 v_u = v_width * CAM_RIGHT;
  vec3 v_v = v_height * CAM_UP;
  vec3 v_uv = v_u+v_v;
  vec3 pixel_delta_u = v_u / float(SCREEN_RESOLUTION.x);
  vec3 pixel_delta_v = v_v / float(SCREEN_RESOLUTION.y);
  vec3 pixel_delta_uv = pixel_delta_u + pixel_delta_v;

  // Calculate camera defocus
  float defocus_angle_rad = DEFOCUS_ANGLE * 3.141592654 / 180.0;
  float defocus_radius = FOCUS_DIST * tan(defocus_angle_rad/2.0);
  vec3 defocus_u = CAM_RIGHT * defocus_radius;
  vec3 defocus_v = CAM_UP * defocus_radius;

  // Calculate world pos of the down left pixel center in the viewport
  vec3 v_down_left = CAM_POS - FOCUS_DIST*CAM_FORWARD - v_uv/2.0;
  vec3 pixel_dow_left = v_down_left + 0.5*pixel_delta_uv;

  // Generate and trace several sample rays for this fragment
  vec3 incoming_light = vec3(0.0);
  for (int s = 0; s < SAMPLES_PER_PIXEL; s++) {
    Ray ray = get_ray_sample(
      pixel_dow_left,
      pixel_delta_u,
      pixel_delta_v,
      defocus_u,
      defocus_v,
      rng_state);
    incoming_light += trace(ray, rng_state);
  }

  // Combine resulting fragment colour from each sample ray
  vec3 res_colour = incoming_light.xyz / float(SAMPLES_PER_PIXEL);

  // Apply exposure, tone map then correct the colours to sRGB to display properly
  res_colour = aces_film(EXPOSURE * res_colour);
  vec4 res_srgb_colour = vec4(linear_to_srgb(res_colour), 1.0);


  // Accumulate an average colour of this fragment using the previous frame
  float weight = 1.0 / float(FRAME + 1);
  vec4 prev_colour = texture(prev_frame, out_tex_coord);
  out_colour = mix(prev_colour, res_srgb_colour, weight);
}
