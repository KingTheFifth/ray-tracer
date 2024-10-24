#version 150

in vec2 out_tex_coord;

// uniform mat4 view_proj_mat;
uniform sampler2D curr_frame;
uniform sampler2D prev_frame;

uniform int frame_num;
out vec4 out_colour;

void main(void) {
  vec4 colour = texture(curr_frame, out_tex_coord);
  vec4 prev_colour = texture(prev_frame, out_tex_coord);

  float weight = 1.0 / (float(frame_num + 1));
  vec4 res_colour = prev_colour * (1.0 - weight) + colour * weight;
  res_colour.x = max(min(res_colour.x, 1.0), 0.0);
  res_colour.y = max(min(res_colour.y, 1.0), 0.0);
  res_colour.z = max(min(res_colour.z, 1.0), 0.0);
  res_colour.w = max(min(res_colour.w, 1.0), 0.0);
  out_colour = res_colour;
}
