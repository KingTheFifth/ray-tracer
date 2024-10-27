/*
 * NB! Make sure to keep order and type of the struct members consistent with
 * the same struct in tracer.frag. Padding and alignment needs to be correct
 * when uploading to GPU.
 */
#pragma once
#include "VectorUtils4.h"

struct Material {
  vec4 albedo;
  vec4 emission_colour;
  GLfloat emission_strength;
  GLfloat specular_chance;
  GLfloat specular_roughness;
  GLfloat specular_fuzz;
  vec4 specular_colour;
  vec4 refraction_colour;
  GLfloat ior;
  GLfloat refraction_chance;
  GLfloat refraction_roughness;
  GLfloat f0;
  GLfloat f90;
  GLfloat padding[3];

  static Material init_zero() {
    Material m{};
    m.albedo = vec4(0.0, 0.0, 0.0, 0.0);
    m.emission_strength = 0.0;
    m.emission_colour = vec4(0.0, 0.0, 0.0, 0.0);
    m.specular_chance = 0.0;
    m.specular_colour = vec4(0.0, 0.0, 0.0, 0.0);
    m.specular_roughness = 0.0;
    m.specular_fuzz = 0.0;
    m.ior = 1.0;
    m.refraction_chance = 0.0;
    m.refraction_roughness = 0.0;
    m.refraction_colour = vec4(0.0, 0.0, 0.0, 0.0);
    m.f0 = 0.0;
    m.f90 = 1.0;
    return m;
  }

  static Material init_diffuse(vec3 albedo) {
    Material m = init_zero();
    m.albedo = vec4(albedo, 0.0);
    return m;
  }

  static Material init_specular(vec3 albedo, vec3 specular_colour,
                                GLfloat specular_chance,
                                GLfloat specular_roughness, GLfloat fuzz) {
    Material m = init_diffuse(albedo);
    m.specular_colour = vec4(specular_colour, 0.0);
    m.specular_chance = specular_chance;
    m.specular_roughness = specular_roughness;
    m.specular_fuzz = fuzz;
    m.f90 = 1.0;
    return m;
  }

  static Material init_light(vec3 emission_colour, GLfloat emission_strength) {
    Material m = init_zero();
    m.emission_colour = vec4(emission_colour, 0.0);
    m.emission_strength = emission_strength;
    return m;
  }

  static Material init_dielectric(vec3 refraction_colour, GLfloat IOR,
                                  GLfloat refraction_chance,
                                  GLfloat refraction_roughness, vec3 albedo,
                                  vec3 specular_colour) {
    Material m = init_zero();
    m.albedo = vec4(albedo, 0.0);
    m.specular_colour = vec4(specular_colour, 0.0);
    m.specular_chance = 0.02;
    m.specular_roughness = refraction_roughness;
    m.ior = IOR;
    m.refraction_colour = vec4(refraction_colour, 0.0);
    m.refraction_chance = refraction_chance;
    m.refraction_roughness = refraction_roughness;
    m.f90 = 1.0;
    return m;
  }
};
