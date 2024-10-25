#version 150

struct Ray {
  vec3 pos;
  vec3 dir;
};

struct Material {
  vec3 colour;
  float emission_strength;
  vec3 emission_colour;
  float specular_probability;
  vec3 specular_colour;
  float smoothness;
  float padding;
  float fuzz;
  float refraction_index;
  bool refractive;
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
  vec3 pos;
  float radius;
  Material material;
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

// Parameters for camera and rays
uniform float CAMERA_DEPTH;
uniform float VFOV;
uniform float DEFOCUS_ANGLE;
uniform int SAMPLES_PER_PIXEL;
uniform int MAX_BOUNCE_COUNT;
const vec3 cam_pos = vec3(0.0, 0.0, 0.0);

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

// Functions for creating rays and handling their collisions ------------------

// Creates a randomly jittered ray for this fragment
// Useful for doing multiple ray samples per fragment
Ray get_ray_sample(vec3 view_pos, inout uint rng_state) {
  Ray ray;
  ray.pos = cam_pos;
  // vec3 jitter = vec3(sample_square(rng_state), 0.0) * SAMPLE_JITTER_STRENGTH;
  // ray.dir = normalize(view_pos+jitter-ray.pos);
  ray.dir = normalize(view_pos-ray.pos);
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
  vec3 offs = sphere.pos-ray.pos;
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
    float dist = (-b-sqrtd) / (2.0 * a);
    // if (dist <= -0.001) {
    //   dist = (-b+sqrtd) / (2.0 * a);
    // }
    if (dist >= 0.001) {
      hit.did_hit = true;
      hit.pos = ray.pos + ray.dir * dist; 
      hit.normal = normalize(hit.pos - sphere.pos);
      hit.dist = dist;
      hit.material = sphere.material;

      // Keep normals pointing against the ray and keep track of surface side
      hit.front_face = dot(ray.dir, hit.normal) <= 0.0;
      hit.normal = mix(-hit.normal, hit.normal, float(hit.front_face));
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
// Reflects a vector v in the axis given by vector n
vec3 reflect(vec3 v, vec3 n) {
  return v - 2.0*dot(v, n) * n;
}

float reflectance(float cos_theta, float refraction_index) {
  float r0 = (1.0 - refraction_index) / (1.0 + refraction_index);
  r0 = r0*r0;
  return r0 + (1.0-r0) * pow(1.0-cos_theta, 5.0);
}

// Returns the vector v refracted at a boundary between two mediums.
// n is the normal of the boundary and relative_eta is ratio of refractive
// indices between the mediums (exited medium over entered medium).
// The bool possible is set to true if a refraction can happen, and false
// if total internal reflection occurs instead
vec3 refract(vec3 v, vec3 n, float relative_eta, inout uint rng_state, out bool possible) {
  float cos_theta = min(dot(-v, n), 1.0);
  float sin_theta = sqrt(1.0-cos_theta*cos_theta);

  // Use Snell's law together with Schlick approximation so that refraction
  // does not happen at steep angles
  possible = relative_eta * sin_theta <= 1.0 && reflectance(cos_theta, relative_eta) <= random_float(rng_state);

  vec3 r_out_perp = relative_eta * (v + cos_theta * n);
  vec3 r_out_parallel = -sqrt(abs(1.0 - dot(r_out_perp, r_out_perp))) * n;
  return r_out_perp + r_out_parallel;
}

// Returns the incoming light from this ray
vec3 trace(Ray ray, inout uint rng_state) {
  vec3 incoming_light = vec3(0.0, 0.0, 0.0);
  vec3 ray_colour = vec3(1.0, 1.0, 1.0);

  for (int b = 0; b < MAX_BOUNCE_COUNT; b++) {
    Hit closest_hit = ray_collision(ray);

    if (closest_hit.did_hit) {
      ray.pos = closest_hit.pos;
      Material material = closest_hit.material;

      // Calculate ray direction for a reflection bounce 
      // (-> diffuse & specular light)
      vec3 diffuse_dir = normalize(closest_hit.normal + random_direction(rng_state));
      vec3 fuzz = material.fuzz * random_direction(rng_state);
      vec3 specular_dir = normalize(reflect(ray.dir, closest_hit.normal)) + fuzz;
      float specular_bounce = float(material.specular_probability >= random_float(rng_state));
      vec3 reflect_dir = normalize(mix(diffuse_dir, specular_dir, material.smoothness * specular_bounce));

      // Calculate ray direction for refraction (-> transparency)
      bool can_refract = true;
      float r_i = material.refraction_index;
      r_i = mix(r_i, 1.0/r_i, float(closest_hit.front_face));
      vec3 refract_dir = normalize(refract(ray.dir, closest_hit.normal, r_i, rng_state, can_refract));

      // Decide between reflection or refraction based on material properties
      // and whether a refraction is possible due to physical phenomena
      bool refraction = can_refract && material.refractive;
      ray.dir = mix(reflect_dir, refract_dir, float(refraction));

      // Try to catch bad ray directions that would lead to NaN or infinity
      float tol = 0.000001;
      if (abs(ray.dir.x) < tol && abs(ray.dir.y) < tol && abs(ray.dir.z) < tol) {
        ray.dir = closest_hit.normal;
      }

      // Update light
      vec3 emitted_light = material.emission_colour * material.emission_strength;
      incoming_light += emitted_light * ray_colour;
      ray_colour *= mix(material.colour, material.specular_colour, specular_bounce);
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

  // Calculate viewport dimensions depending on FOV
  float fov_angle_rad = VFOV * 3.141592654 / 180.0;
  float h = tan(fov_angle_rad / 2.0);
  float v_height = 2.0 * h * CAMERA_DEPTH;
  float v_width = v_height * ASPECT_RATIO;
  vec3 v_uv = vec3(v_width, v_height, 1.0); // Viewport dimensions

  // Calculate viewport position (pixel center) of this fragment
  vec3 pixel_delta_uv = v_uv / vec3(SCREEN_RESOLUTION, 1.0);
  vec3 v_upper_left = cam_pos - vec3(0.0, 0.0, CAMERA_DEPTH) - v_uv/2.0;
  vec3 ij = vec3(out_tex_coord*vec2(SCREEN_RESOLUTION), 0.0); // pixel indices
  vec3 jitter = vec3(sample_square(rng_state), 0.0);  // Jitter for antialiasing
  vec3 view_pos = v_upper_left + 0.5*pixel_delta_uv + (ij+jitter)*pixel_delta_uv;

  // Generate and trace several sample rays for this fragment
  vec3 incoming_light = vec3(0.0, 0.0, 0.0);
  for (int s = 0; s < SAMPLES_PER_PIXEL; s++) {
    Ray ray = get_ray_sample(view_pos, rng_state);
    incoming_light += trace(ray, rng_state);
  }

  // Combine resulting fragment colour from each sample ray
  vec4 res_colour = vec4(incoming_light / float(SAMPLES_PER_PIXEL), 1.0);

  // Clamp
  res_colour.x = max(min(res_colour.x, 1.0), 0.0);
  res_colour.y = max(min(res_colour.y, 1.0), 0.0);
  res_colour.z = max(min(res_colour.z, 1.0), 0.0);
  //res_colour.w = max(min(res_colour.w, 1.0), 0.0);

  // Accumulate an average colour of this fragment using the previous frame
  float weight = 1.0 / float(FRAME + 1);
  vec4 prev_colour = texture(prev_frame, out_tex_coord);
  out_colour = res_colour * weight + (1.0-weight)*texture(prev_frame, out_tex_coord);
}
