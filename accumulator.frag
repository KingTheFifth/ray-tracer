#version 150

in vec2 out_tex_coord;

// uniform mat4 view_proj_mat;
uniform sampler2D curr_frame;
uniform sampler2D prev_frame;

uniform int frame_num;

void main(void) {
  vec4 colour = texture(curr_frame, out_tex_coord);
  vec4 prev_colour = texture(prev_frame, out_tex_coord);

  float weight = 1.0 / (frame_num + 1);
  vec4 res_colour = prev_colour * (1 - weight) + colour * weight;
  res_colour = max(min(res_colour, 1.0), 0.0);
  gl_FragColor = vec4(out_tex_coord, 0.0, 1.0);
}
