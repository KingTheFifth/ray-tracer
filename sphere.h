#pragma once
#include "VectorUtils4.h"
#include "material.h"

// Make sure to keep this consistent with tracer.frag!
struct Sphere {
  vec3 pos;
  float radius;
  Material material;
  // vec4 PADDING;
};
