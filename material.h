/*
 * NB! Make sure to keep this struct consistent with the one in tracer.frag!
 *
 */
#pragma once
#include "VectorUtils4.h"

struct Material {
  vec3 colour;
  float PADDING;
  vec3 emission_colour;
  float emission_strength;
};
