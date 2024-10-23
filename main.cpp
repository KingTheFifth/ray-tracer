// Revised 2019 with a bit better variable names.
// Experimental C++ version 2022. Almost no code changes.

#include <GL/gl.h>
#include <GL/glext.h>
#define MAIN
#include "GL_utilities.h"
#include "LittleOBJLoader.h"
#include "MicroGlut.h"
#include "VectorUtils4.h"
// uses framework OpenGL
// uses framework Cocoa

// Globals

// Window dimensions, needed for FBOs
const int initWidth = 800, initHeight = 800;
const float DEPTH = 1.0f;
int frame = 0;
GLuint accumulator, tracer, plain_tex_shader;
Model *triangle_model;
FBOstruct *prev_frame, *curr_frame;

void init(void) {
  dumpInfo();

  // GL inits
  glClearColor(0.0, 0.0, 0.0, 0.0);
  glDisable(GL_DEPTH_TEST);
  glDisable(GL_CULL_FACE);
  printError("GL inits"); // This is merely a vague indication of where
                          // something might be wrong
  // Load and compile shader
  accumulator = loadShaders("shader.vert", "accumulator.frag");
  tracer = loadShaders("shader.vert", "tracer.frag");
  plain_tex_shader = loadShaders("shader_cursed.vert", "plain.frag");
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
}

void display(void) {
  printError("pre display");
  // clear the screen
  glClearColor(0.0, 0.0, 0.0, 0.5);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

  // Do one round of ray tracing into curr_frame ------------------------------
  glUseProgram(tracer);
  useFBO(curr_frame, 0L, 0L);
  glUniform1i(glGetUniformLocation(tracer, "tex_unit"), 0);
  glUniform1i(glGetUniformLocation(tracer, "NUM_SPHERES"), 0);
  glUniform1f(glGetUniformLocation(tracer, "CAMERA_DEPTH"), DEPTH);
  glUniform1f(glGetUniformLocation(tracer, "ASPECT_RATIO"),
              (GLfloat)initWidth / initHeight);
  DrawModel(triangle_model, tracer, "in_position", NULL, "in_tex_coord");

  // Accumulate the output image into prev_frame ------------------------------
  glUseProgram(accumulator);
  glUniform1i(glGetUniformLocation(accumulator, "curr_frame"), 0);
  glUniform1i(glGetUniformLocation(accumulator, "prev_frame"), 1);

  useFBO(prev_frame, curr_frame, prev_frame);
  frame++;
  glUniform1i(glGetUniformLocation(accumulator, "frame_num"), frame);
  DrawModel(triangle_model, tracer, "in_position", NULL, "in_tex_coord");

  // Draw result in prev_frame ------------------------------------------------
  glUseProgram(plain_tex_shader);
  glUniform1i(glGetUniformLocation(plain_tex_shader, "tex_unit"), 0);

  // Output to screen frame buffer
  useFBO(0L, prev_frame, 0L);
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
