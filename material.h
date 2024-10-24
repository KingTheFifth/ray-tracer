/*
 * NB! Make sure to keep order and type of the struct members consistent with
 * the same struct in tracer.frag. Padding and alignment needs to be correct
 * when uploading to GPU.
 * Pad everything so that the struct size is multiple of vec4 i.e. 4 floats.
 * It seems that vec3 and vec2 members need to be aligned on multiples of vec4
 */
#pragma once
#include "VectorUtils4.h"

struct Material {
  vec3 colour;
  float emission_strength;
  vec3 emission_colour;
  float specular_probability;
  vec3 specular_colour;
  float smoothness;
  vec3 padding;
  float fuzz;

  Material(vec3 colour, float emission_strength, vec3 emission_colour,
           float specular_probability, vec3 specular_colour, float smoothness,
           float fuzz)
      : colour{colour}, emission_strength{emission_strength},
        emission_colour{emission_colour},
        specular_probability{specular_probability},
        specular_colour{specular_colour}, smoothness{smoothness},
        padding{vec3(0.0, 0.0, 0.0)}, fuzz{fuzz} {}
};
