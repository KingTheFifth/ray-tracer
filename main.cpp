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
const float VERTICAL_FOV = 20;
vec3 cam_pos = vec3(-2.0, 2.0, 1.0);
vec3 cam_look_at = vec3(0.0, 0.0, -1.0);
vec3 cam_up = vec3(0.0, 1.0, 0.0);
float defocus_angle = 10.0;
float focus_dist = 3.4;

GLuint sphere_ubo;
GLuint sphere_block_binding = 0;
vec3 black = vec3(0.0, 0.0, 0.0);
vec3 white = vec3(1.0, 0.9, 0.8);
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
Material gray_fuzz = Material{gray, 0.0f, black, 1.0f, white, 1.0f, 0.6f};
Material clear_glass =
    Material{white, 0.0f, black, 0.6f, white, 0.9f, 0.0f, 1.5f};
Material bubble =
    Material{white, 0.0f, black, 1.0f, white, 1.0f, 0.0f, 1.0f / 1.5f};

// const int num_spheres = 9;
// Sphere spheres[num_spheres] = {
//     Sphere{vec3(1.5, 0.5, -4.0), 0.5, red_glossy},
//     Sphere{vec3(0.4, -0.4, -0.7), 0.1, green_matte},
//     Sphere{vec3(-1.0, -0.25, -2.0), 0.25, cyan_funky},
//     Sphere{vec3(0.0, -100.5, -1.0), 100, blue_matte},
//     // Sphere{vec3(0.0, -0.2, -2.0), 0.1, white_light},
//     Sphere{vec3(0.0, 10.0, -2.0), 2.0, white_light},
//     Sphere{vec3(-0.7, -0.25, -3.0), 0.25, gray_metal},
//     Sphere{vec3(0.9, -0.5, -4.0), 0.5, gray_fuzz},
//     Sphere{vec3(-0.5, -0.25, -1.0), 0.1, clear_glass},
//     Sphere{vec3(-0.5, -0.25, -1.0), 0.08, bubble},
// };

vec3 brown = vec3(0.8, 0.6, 0.2);
Material ground = Material{green, 0.0f, black, 0.0f, black, 0.0f, 0.0f};
Material center = Material{blue, 0.0f, black, 0.0f, black, 0.0f, 0.0f};
Material left = Material{white, 0.0f, black, 1.0f, white, 1.0f, 0.0f, 1.5f};
Material bubble2 =
    Material{white, 0.0f, black, 1.0f, white, 1.0f, 0.0f, 1.0 / 1.5f};
Material right = Material{brown, 0.0f, black, 1.0f, brown, 0.8f, 1.0f};
const int num_spheres = 5;
Sphere spheres[num_spheres] = {
    Sphere{vec3(0.0, -100.5, -1.0), 100.0, ground},
    Sphere{vec3(0.0, 0.0, -1.2), 0.5, center},
    Sphere{vec3(-1.0, 0.0, -1.0), 0.5, left},
    Sphere{vec3(-1.0, 0.0, -1.0), 0.4, bubble2},
    Sphere{vec3(1.0, 0.0, -1.0), 0.5, right},
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
  glutRepeatingTimer(20);

  init();
  glutMainLoop();
  exit(0);
}
