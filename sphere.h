#pragma once
#include "VectorUtils4.h"
#include "material.h"

// NB! Make sure the order of the members are the same as the sphere struct
// in tracer.frag!
// Padding needed as the struct needs to have the aligment of a vec4 i.e. 4
// GLfloats
struct Sphere {
  Material material;
  vec4 pos;
  GLfloat radius;
  GLfloat padding[3];
  Sphere(vec3 pos, GLfloat radius, Material material)
      : material{material}, pos{vec4(pos, 0.0)}, radius{radius} {}

  Sphere() : material{Material::init_zero()}, pos{vec4(0.0)}, radius{0.0} {}
};
