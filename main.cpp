// Revised 2019 with a bit better variable names.
// Experimental C++ version 2022. Almost no code changes.

#include <GL/gl.h>
#include <GL/glext.h>
#define MAIN
#include "GL_utilities.h"
#include "LittleOBJLoader.h"
#include "MicroGlut.h"
#include "VectorUtils4.h"
#include "sphere.h"
// uses framework OpenGL
// uses framework Cocoa

// Globals

// Window dimensions, needed for FBOs
const int initWidth = 800, initHeight = 800;
const float DEPTH = 1.0f;
const uint SAMPLES_PER_PIXEL = 40;
const float SAMPLE_JITTER_STRENGTH = 3.0f;
const int MAX_BOUNCE_COUNT = 20;
int frame = 0;
GLuint tracer, plain_tex_shader;
Model *triangle_model;
FBOstruct *prev_frame, *curr_frame;

GLuint sphere_ubo;
const int num_spheres = 7;
GLuint sphere_block_binding = 0;
vec3 black = vec3(0.0, 0.0, 0.0);
vec3 white = vec3(1.0, 1.0, 1.0);
vec3 gray = white * 0.5;
vec3 red = vec3(1.0, 0.0, 0.0);
vec3 cyan = vec3(0.0, 0.7, 0.7);
vec3 green = vec3(0.0, 0.5, 0.0);
vec4 blue = vec3(0.0, 0.0, 0.5);
Material red_glossy = Material{red, 0.0f, black, 0.3f, white, 0.7f, 0.0f};
Material green_matte = Material{green, 0.0f, black, 0.0f, black, 1.0f, 0.0f};
Material blue_matte = Material{blue, 0.0f, black, 0.0f, black, 1.0f, 0.0f};
Material white_light = Material{black, 100.0f, white, 0.0f, black, 0.0f, 0.0f};
Material cyan_funky = Material{cyan, 5.0f, green, 0.3f, blue, 0.1f, 0.0f};
Material gray_metal = Material{gray, 0.0f, black, 1.0f, white, 1.0f, 0.0f};
Material gray_fuzz = Material{gray, 0.0f, black, 1.0f, white, 1.0f, 0.8f};

Sphere spheres[num_spheres] = {
    Sphere{vec3(1.5, 0.5, -4.0), 0.5, red_glossy},
    Sphere{vec3(0.4, -0.4, -0.7), 0.1, green_matte},
    Sphere{vec3(-1.0, -0.25, -2.0), 0.25, cyan_funky},
    Sphere{vec3(0.0, -100.5, -1.0), 100, blue_matte},
    Sphere{vec3(0.0, -0.2, -2.0), 0.1, white_light},
    Sphere{vec3(-0.7, -0.25, -3.0), 0.25, gray_metal},
    Sphere{vec3(0.7, -0.25, -3.0), 0.25, gray_fuzz},
};

void init(void) {
  dumpInfo();

  // GL inits
  glClearColor(0.0, 0.0, 0.0, 0.0);
  glDisable(GL_DEPTH_TEST);
  glDisable(GL_CULL_FACE);
  printError("GL inits"); // This is merely a vague indication of where
                          // something might be wrong
  // Load and compile shader
  tracer = loadShaders("shader.vert", "tracer.frag");
  plain_tex_shader = loadShaders("shader.vert", "plain.frag");
  printError("init shader");

  // Set up FBOs
  curr_frame = initFBO(initWidth, initHeight, 0);
  prev_frame = initFBO(initWidth, initHeight, 0);

  // Set up triangle used to cover the screen
  GLfloat triangle[] = {
      -1.0f, -1.0f, DEPTH, 3.0f, -1.0f, DEPTH, -1.0f, 3.0f, DEPTH,
  };
  GLfloat triangle_tex_coords[] = {
      0.0f, 0.0f, 2.0f, 0.0f, 0.0f, 2.0f,
  };
  GLuint triangle_indices[] = {0, 2, 1};

  triangle_model =
      LoadDataToModel((vec3 *)triangle, NULL, (vec2 *)triangle_tex_coords, NULL,
                      triangle_indices, 3, 3);
  printError("load models");

  // Create a UBO (uniform buffer object) containing array of spheres
  glGenBuffers(1, &sphere_ubo);
  glBindBuffer(GL_UNIFORM_BUFFER, sphere_ubo);
  glBufferData(GL_UNIFORM_BUFFER, sizeof(Sphere) * num_spheres,
               (void *)&spheres[0], GL_STATIC_DRAW);
  glBindBuffer(GL_UNIFORM_BUFFER, 0);
  printError("generate sphere ubo");
}

void display(void) {
  printError("pre display");
  // clear the screen
  glClearColor(0.0, 0.0, 0.0, 0.5);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

  // Do one round of ray tracing into curr_frame ------------------------------
  frame++;

  glUseProgram(tracer);

  // Bind sphere UBO and the corresponding shader block to a common binding
  // point
  GLuint sphere_block_index = glGetUniformBlockIndex(tracer, "SphereBlock");
  glUniformBlockBinding(tracer, sphere_block_index, sphere_block_binding);
  glBindBufferBase(GL_UNIFORM_BUFFER, sphere_block_binding, sphere_ubo);
  printError("bind sphere ubo");

  useFBO(curr_frame, prev_frame, 0L);
  glUniform1i(glGetUniformLocation(tracer, "prev_frame"), 0);
  glUniform1i(glGetUniformLocation(tracer, "FRAME"), frame);
  glUniform2ui(glGetUniformLocation(tracer, "SCREEN_RESOLUTION"), initWidth,
               initHeight);
  glUniform1i(glGetUniformLocation(tracer, "NUM_SPHERES"), num_spheres);
  glUniform1f(glGetUniformLocation(tracer, "CAMERA_DEPTH"), DEPTH);
  glUniform1f(glGetUniformLocation(tracer, "ASPECT_RATIO"),
              (GLfloat)initWidth / initHeight);
  glUniform1i(glGetUniformLocation(tracer, "SAMPLES_PER_PIXEL"),
              SAMPLES_PER_PIXEL);
  glUniform1f(glGetUniformLocation(tracer, "SAMPLE_JITTER_STRENGTH"),
              SAMPLE_JITTER_STRENGTH);
  glUniform1i(glGetUniformLocation(tracer, "MAX_BOUNCE_COUNT"),
              MAX_BOUNCE_COUNT);

  DrawModel(triangle_model, tracer, "in_position", NULL, "in_tex_coord");

  // Accumulate the output image into prev_frame ------------------------------
  glUseProgram(plain_tex_shader);
  glUniform1i(glGetUniformLocation(plain_tex_shader, "tex_unit"), 0);

  // Overwrite prev_frame with current frame
  useFBO(prev_frame, curr_frame, 0L);
  DrawModel(triangle_model, plain_tex_shader, "in_position", NULL,
            "in_tex_coord");

  // Draw result to screen ----------------------------------------------------
  glUseProgram(plain_tex_shader);
  glUniform1i(glGetUniformLocation(plain_tex_shader, "tex_unit"), 0);

  // Output to screen
  useFBO(0L, curr_frame, 0L);
  DrawModel(triangle_model, plain_tex_shader, "in_position", NULL,
            "in_tex_coord");

  glutSwapBuffers();
}

int main(int argc, char *argv[]) {
  glutInit(&argc, argv);
  glutInitDisplayMode(GLUT_RGBA | GLUT_DEPTH | GLUT_DOUBLE);
  glutInitContextVersion(3, 2);
  glutInitWindowSize(initWidth, initHeight);
  glutCreateWindow("GPU Ray tracer");
  glutDisplayFunc(display);
  glutRepeatingTimer(20);

  init();
  glutMainLoop();
  exit(0);
}
