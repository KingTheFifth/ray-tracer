#version 150

in vec2 out_tex_coord;

uniform sampler2D tex_unit;

out vec4 out_colour;

void main(void) {
  out_colour = texture(tex_unit, out_tex_coord);
}

