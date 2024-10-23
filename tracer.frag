#version 150

struct Ray {
  vec3 pos;
  vec3 dir;
};

struct Material {
  vec4 colour;
};

struct Hit {
  int did_hit;
  vec3 pos;
  vec3 normal;
  Material material;
  float dist;
  bool front_face;
};

struct Sphere {
  vec3 pos;
  float radius;
  Material material;
  // vec4 PADDING;

};

Hit ray_sphere_intersect(Ray ray, Sphere sphere) {
  Hit hit;
  hit.did_hit = 0;

  vec3 offs = ray.pos - sphere.pos;
  float a = dot(ray.dir, ray.dir);
  float b = 2.0 * dot(offs, ray.dir);
  float c = dot(offs, offs) - sphere.radius*sphere.radius;

  float discriminant = b * b - 4.0 * a * c;

  if (discriminant >= 0) {
    float dist = (-b-sqrt(discriminant)) / (2.0 * a);
    if (dist >= 0) {
      hit.did_hit = 1;
      hit.dist = dist;
      hit.pos = ray.pos + ray.dir * dist; 
      hit.normal = normalize(hit.pos - sphere.pos);
      hit.material = sphere.material;
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

uniform int NUM_SPHERES;
uniform float CAMERA_DEPTH;
uniform float ASPECT_RATIO;

void main(void) {
  vec3 view_pos = vec3(out_tex_coord * 2.0 - 1.0, CAMERA_DEPTH);
  view_pos.y = view_pos.y / ASPECT_RATIO;


  Ray ray;
  ray.pos = vec3(0.0, 0.0, 0.0);
  ray.dir = normalize(view_pos - ray.pos);

  vec4 res_colour = vec4(0.0, 0.0, 0.0, 0.0);
  for (int i = 0; i < NUM_SPHERES; i++) {
    Sphere sphere = spheres[i];
    Hit hit = ray_sphere_intersect(ray, sphere);
    res_colour += hit.material.colour * hit.did_hit;
  }
  
  // Sphere sphere;
  // sphere.pos = vec3(0.0, 0.0, 2.0);
  // sphere.radius = 1.0;
  // int did_hit = ray_sphere_intersect(ray, sphere).did_hit;
  // out_colour = vec4(did_hit, did_hit, did_hit, 1.0); 

  //out_colour = vec4(view_pos, 1.0);

  // TODO: clamp
  out_colour = res_colour;
}
