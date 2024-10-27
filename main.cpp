// Revised 2019 with a bit better variable names.
// Experimental C++ version 2022. Almost no code changes.

#include <GL/gl.h>
#include <GL/glext.h>
#include <cstdlib>
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
const double ASPECT_RATIO = 16.0 / 9.0;
const int SCREEN_WIDTH = 800;
const int SCREEN_HEIGHT = int(SCREEN_WIDTH / ASPECT_RATIO);

// Ray parameters
const uint SAMPLES_PER_PIXEL = 20;
const int MAX_BOUNCE_COUNT = 20;

// Shaders and shader parameters
int frame = 0;
GLuint tracer, plain_tex_shader;
Model *triangle_model;
FBOstruct *prev_frame, *curr_frame;

// Camera parameters
const float VERTICAL_FOV = 60;
vec3 cam_pos = vec3(-2.0, 0.2, 1.0);
vec3 cam_look_at = vec3(0.0, 0.0, -1.0);
vec3 cam_up = vec3(0.0, 1.0, 0.0);
float defocus_angle = 0.9;
float focus_dist = 2.7;
float EXPOSURE = 0.4;

// Sending sphere data to the GPU
GLuint sphere_ubo;
GLuint sphere_block_binding = 0;
Sphere spheres[15];
GLuint num_spheres = 0;

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
  curr_frame = initFBO(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
  prev_frame = initFBO(SCREEN_WIDTH, SCREEN_HEIGHT, 0);

  // Set up triangle used to cover the screen
  GLfloat triangle[] = {
      -1.0f, -1.0f, 0.0f, 3.0f, -1.0f, 0.0f, -1.0f, 3.0f, 0.0f,
  };
  GLfloat triangle_tex_coords[] = {
      0.0f, 0.0f, 2.0f, 0.0f, 0.0f, 2.0f,
  };
  GLuint triangle_indices[] = {0, 2, 1};

  triangle_model =
      LoadDataToModel((vec3 *)triangle, NULL, (vec2 *)triangle_tex_coords, NULL,
                      triangle_indices, 3, 3);
  printError("load models");
  vec3 white = vec3(1.0, 1.0, 1.0);
  vec3 red = vec3(1.2, 0.2, 0.1);
  vec3 green = vec3(0.05, 0.5, 0.05);
  vec3 gold = vec3(0.8, 0.6, 0.2);
  vec3 blue = vec3(0.1, 0.3, 0.8);
  vec3 purple = vec3(0.7, 0.1, 0.7);
  vec3 pink = vec3(0.8, 0.3, 0.5);
  Material ground = Material::init_diffuse(green);
  Material center = Material::init_diffuse(red);
  // Note: setting reflection roughness to 0 for either 'left' or 'bubble'
  // leads to weird refraction for some mysterious reason
  Material left =
      Material::init_dielectric(white, 1.5f, 1.0f, 0.2f, red, white * 0.8);
  Material bubble =
      Material::init_dielectric(white, 1.0 / 1.5f, 1.0f, 0.001f, white, white);
  Material right = Material::init_specular(gold, gold, 1.0f, 0.2f, 0.3f);
  Material light = Material::init_light(white * 0.8, 100.0);
  Material clear_glass =
      Material::init_dielectric(white, 1.5, 1.0, 0.0, white, white);
  Material purple_glass = Material::init_dielectric(vec3(0.1, 3.0, 0.1), 1.1,
                                                    0.8, 0.1, white, white);
  Material purple_metal = Material::init_specular(blue, purple, 0.8, 0.1, 0.0);
  Material pink_marble =
      Material::init_specular(pink, white * 0.8, 0.02, 0.01, 0.01);
  pink_marble =
      Material::init_dielectric(white, 2.0, 0.0, 0.0, pink, white * 0.8);

  // Set up scene with spheres
  num_spheres = 11;
  spheres[0] = Sphere{vec3(0.0, -100.515, -1.0), 100.0, ground};
  spheres[1] = Sphere{vec3(0.0, 0.0, -1.2), 0.5, center};
  spheres[2] = Sphere{vec3(-1.0, 0.0, -1.0), 0.5, left};
  spheres[3] = Sphere{vec3(-1.0, 0.0, -1.0), 0.4, bubble};
  spheres[4] = Sphere{vec3(1.0, 0.0, -1.0), 0.5, right};
  spheres[5] = Sphere{vec3(0.0, 10.0, 7.0), 1.0, light};
  spheres[6] = Sphere{vec3(0.0, -0.25, 0.0), 0.25, clear_glass};
  spheres[7] = Sphere{vec3(-0.7, -0.2, 0.0), 0.125, purple_glass};
  spheres[8] =
      Sphere{vec3(-1.5, -0.3, -4.5), 0.3, Material::init_diffuse(blue)};
  spheres[9] = Sphere{vec3(-1.9, -0.39, -1.3), 0.125, pink_marble};
  spheres[10] = Sphere{vec3(-0.6, -0.385, 0.7), 0.125, purple_metal};

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
  glUniform2ui(glGetUniformLocation(tracer, "SCREEN_RESOLUTION"), SCREEN_WIDTH,
               SCREEN_HEIGHT);
  glUniform1i(glGetUniformLocation(tracer, "NUM_SPHERES"), num_spheres);
  glUniform1f(glGetUniformLocation(tracer, "VFOV"), VERTICAL_FOV);
  glUniform1f(glGetUniformLocation(tracer, "ASPECT_RATIO"),
              (GLfloat)SCREEN_WIDTH / SCREEN_HEIGHT);
  glUniform1i(glGetUniformLocation(tracer, "SAMPLES_PER_PIXEL"),
              SAMPLES_PER_PIXEL);
  glUniform1i(glGetUniformLocation(tracer, "MAX_BOUNCE_COUNT"),
              MAX_BOUNCE_COUNT);

  // Upload camera parameters
  vec3 cam_forward = normalize(cam_pos - cam_look_at);
  vec3 cam_right = normalize(cross(cam_up, cam_forward));
  vec3 cam_up_adjusted = cross(cam_forward, cam_right);
  glUniform3fv(glGetUniformLocation(tracer, "CAM_FORWARD"), 1,
               (GLfloat *)&cam_forward);
  glUniform3fv(glGetUniformLocation(tracer, "CAM_RIGHT"), 1,
               (GLfloat *)&cam_right);
  glUniform3fv(glGetUniformLocation(tracer, "CAM_UP"), 1,
               (GLfloat *)&cam_up_adjusted);
  glUniform3fv(glGetUniformLocation(tracer, "CAM_POS"), 1, (GLfloat *)&cam_pos);
  glUniform1f(glGetUniformLocation(tracer, "DEFOCUS_ANGLE"), defocus_angle);
  glUniform1f(glGetUniformLocation(tracer, "FOCUS_DIST"), focus_dist);
  glUniform1f(glGetUniformLocation(tracer, "EXPOSURE"), EXPOSURE);

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
  glutInitWindowSize(SCREEN_WIDTH, SCREEN_HEIGHT);
  glutCreateWindow("GPU Ray tracer");
  glutDisplayFunc(display);
  glutRepeatingTimer(40);

  init();
  glutMainLoop();
  exit(0);
}
