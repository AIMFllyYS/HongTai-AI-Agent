#version 100
precision highp float;

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/** @backdrop */
uniform sampler2D u_backdrop;

/**
 * @label Laser Color
 * @color
 * @default #5EEAD4
 */
uniform vec3 u_laser;

/**
 * @label Speed
 * @default 0.36
 * @range 0.12, 1.0
 */
uniform float u_speed;

/**
 * @label Line Width
 * @default 0.01
 * @range 0.004, 0.03
 */
uniform float u_lineWidth;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec4 bg = texture2D(u_backdrop, uv);

  float scan = fract(u_time * u_speed);
  float y = 1.0 - scan;
  float d = abs(uv.y - y);
  float line = smoothstep(u_lineWidth, 0.0, d);
  float glow = smoothstep(u_lineWidth * 7.0, 0.0, d);
  float trail = 0.0;
  if (uv.y < y && (y - uv.y) < 0.2) {
    trail = (1.0 - (y - uv.y) / 0.2) * 0.22;
  }

  vec3 color = bg.rgb * 0.9;
  color += u_laser * glow * 0.5;
  color += u_laser * line * 1.0;
  color += u_laser * trail * 0.4;

  gl_FragColor = vec4(color, 1.0);
}
