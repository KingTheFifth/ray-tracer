#version 150

in vec3 in_position;
in vec2 in_tex_coord;

out vec2 out_tex_coord;

void main(void) {
  out_tex_coord = in_tex_coord;
  gl_Position = vec4(in_position, 1.0);
}
