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
  // vec4 PADDING;

};

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

    // dist >= 0.001 rather than 0.0 is to combat shadow acne caused by 
    // floating point inaccuracy
    float dist = (-b-sqrt(discriminant)) / (2.0 * a);
    if (dist >= 0.001) {
      hit.did_hit = true;
      hit.pos = ray.pos + ray.dir * dist; 
      hit.normal = normalize(hit.pos - sphere.pos);
      hit.dist = dist;
      hit.material = sphere.material;

      // hit.front_face = dot(ray.dir, hit.normal) <= 0.0;
      // hit.normal = float(hit.front_face) *hit.normal + (1.0-float(hit.front_face))* (-hit.normal);
      //hit.normal = sign(dot(ray.dir, hit.normal)) * hit.normal;
      // if (hit.front_face) {
      //   hit.normal = hit.normal;
      // }
      // else {
      //   hit.normal = -hit.normal;
      // }
    }
  }
  return hit;
}

// layout (std140, binding = 1) uniform SphereBlock {
layout (std140) uniform SphereBlock {
  Sphere spheres[10];
};

in vec2 out_tex_coord;
out vec4 out_colour;

uniform uvec2 SCREEN_RESOLUTION;
uniform int FRAME;
uniform int NUM_SPHERES;
uniform float CAMERA_DEPTH;
uniform float ASPECT_RATIO;
uniform int SAMPLES_PER_PIXEL;
uniform float SAMPLE_JITTER_STRENGTH;
uniform int MAX_BOUNCE_COUNT;

uniform sampler2D prev_frame;

const vec3 cam_pos = vec3(0.0, 0.0, 0.0);

uint wang_hash(inout uint rng_state) {
  rng_state = uint(rng_state ^ uint(61)) ^ uint(rng_state >> uint(16));
  rng_state *= uint(9);
  rng_state = rng_state ^ (rng_state >> 4);
  rng_state *= uint(0x27d4eb2d);
  rng_state = rng_state ^ (rng_state >> 15);
  return rng_state;
}

float random_float(inout uint state) {
  return float(wang_hash(state)) / 4294967296.0;
}

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

vec2 sample_square(inout uint rng_state) {
  return vec2(random_float(rng_state)-0.5, random_float(rng_state)-0.5);
}

vec2 sample_circle(inout uint rng_state) {
  float angle = random_float(rng_state) * 2.0 * 3.141592654; 
  vec2 point_on_circle = vec2(cos(angle), sin(angle));
  return point_on_circle * sqrt(random_float(rng_state));
}

Ray get_ray_sample(vec3 view_pos, inout uint rng_state) {
  Ray ray;
  ray.pos = cam_pos;
  vec3 jitter = vec3(sample_square(rng_state), 0.0) * SAMPLE_JITTER_STRENGTH / float(SCREEN_RESOLUTION.x);
  ray.dir = normalize(view_pos+jitter-ray.pos);
  return ray;
}

vec3 get_background_light(Ray ray) {
  // Calculate a background colour as a nice white to blue gradient along y
  float a = 0.5*(normalize(ray.dir).y+1.0);
  return (1.0-a)*vec3(1.0, 1.0, 1.0)+a*vec3(0.5,0.7,1.0);
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

vec3 reflect(vec3 v, vec3 n) {
  return v - 2.0*dot(v, n) * n;
}

// Returns the incoming light from this ray
vec3 trace(Ray ray, inout uint rng_state) {
  vec3 incoming_light = vec3(0.0, 0.0, 0.0);
  vec3 ray_colour = vec3(1.0, 1.0, 1.0);

  for (int b = 0; b < MAX_BOUNCE_COUNT; b++) {
    Hit closest_hit = ray_collision(ray);

    if (closest_hit.did_hit) {
      Material material = closest_hit.material;


      // Bounce the ray
      ray.pos = closest_hit.pos;
      vec3 diffuse_dir = normalize(closest_hit.normal + random_direction(rng_state));
      vec3 specular_dir = reflect(ray.dir, closest_hit.normal);
      float specular_bounce = float(material.specular_probability >= random_float(rng_state));
      ray.dir = normalize(mix(diffuse_dir, specular_dir, material.smoothness * specular_bounce));

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
      // Ray bounced off into the sky
      incoming_light += get_background_light(ray) * ray_colour;
      break;
    }
  }

  return incoming_light;
}

void main(void) {
  // Get position of this fragment in view space
  // Note that the depth is set so that each fragment resides in a plane 
  // perpendicular to the camera
  vec3 view_pos = vec3(out_tex_coord * 2.0 - 1.0, -CAMERA_DEPTH);
  view_pos.y = view_pos.y / ASPECT_RATIO;

  // Generate a seed for rng using the view position and frame number
  // This gives each fragment an own unique rng seed that changes every frame
  uvec2 pixel_coord = uvec2(out_tex_coord * vec2(SCREEN_RESOLUTION));
  uint pixel_index = pixel_coord.y * SCREEN_RESOLUTION.x + pixel_coord.x;
  uint rng_state = pixel_index + uint(FRAME) * uint(719393);

  vec3 incoming_light = vec3(0.0, 0.0, 0.0);
  for (int s = 0; s < SAMPLES_PER_PIXEL; s++) {
    Ray ray = get_ray_sample(view_pos, rng_state);
    incoming_light += trace(ray, rng_state);
  }

  vec4 res_colour = vec4(incoming_light / float(SAMPLES_PER_PIXEL), 1.0);

  // Clamp
  // res_colour.x = max(min(res_colour.x, 1.0), 0.0);
  // res_colour.y = max(min(res_colour.y, 1.0), 0.0);
  // res_colour.z = max(min(res_colour.z, 1.0), 0.0);
  //res_colour.w = max(min(res_colour.w, 1.0), 0.0);

  // Accumulate an average colour of this pixel using the previous frame
  float weight = 1.0 / float(FRAME + 1);
  out_colour = res_colour * weight + (1.0-weight)*texture(prev_frame, out_tex_coord);
}
