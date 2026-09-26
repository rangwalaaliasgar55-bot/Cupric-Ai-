/* Shader engine: minimal WebGL fullscreen runner + trusted GLSL presets. Uniforms are exposed as props.
 * SECURITY: only registered (trusted) fragment sources can run — imported templates reference presets by id. */
import { parseColor } from "@/core/math";
import { getCanvas } from "@/render/core";

export type ShaderPreset = { id: string; name: string; tags: string[]; description: string; frag: string };
export const SHADERS: Record<string, ShaderPreset> = {};

const HEADER = `precision highp float;
uniform float u_time; uniform vec2 u_res; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_c3;
uniform float u_speed; uniform float u_scale; uniform float u_intensity; uniform float u_seed;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32+u_seed); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
vec3 pal(float t){ return t<0.5 ? mix(u_c1,u_c2,t*2.0) : mix(u_c2,u_c3,(t-0.5)*2.0); }
`;
const S = (id: string, name: string, tags: string[], description: string, body: string) => { SHADERS[id] = { id, name, tags, description, frag: HEADER + body }; };

S("liquid", "Liquid Chrome", ["liquid", "chrome", "premium"], "Domain-warped liquid metal flow.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; uv.x*=u_res.x/u_res.y; float t=u_time*u_speed*0.2; vec2 p=uv*2.5*u_scale;
 vec2 q=vec2(fbm(p+t), fbm(p+vec2(5.2,1.3)-t)); vec2 r=vec2(fbm(p+4.0*q+vec2(1.7,9.2)+t*0.5), fbm(p+4.0*q+vec2(8.3,2.8)));
 float f=fbm(p+4.0*r); vec3 col=pal(clamp(f*1.2,0.0,1.0)); col+=pow(max(0.0,sin(f*12.0+t*3.0)),8.0)*0.35*u_intensity; gl_FragColor=vec4(col,1.0);} `);
S("noiseField", "Noise Field", ["noise", "organic"], "Smooth fbm colour field.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; uv.x*=u_res.x/u_res.y; float n=fbm(uv*3.0*u_scale+u_time*u_speed*0.1); gl_FragColor=vec4(pal(n)*u_intensity,1.0);} `);
S("wave", "Sine Waves", ["waves", "calm"], "Layered glowing sine waves.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; vec3 col=vec3(0.0); for(int i=0;i<5;i++){ float fi=float(i); float y=0.5+0.15*sin(uv.x*6.0*u_scale+u_time*u_speed*(0.5+fi*0.2)+fi); float d=abs(uv.y-y); col+=pal(fi/4.0)*0.004/d*u_intensity; } gl_FragColor=vec4(col,1.0);} `);
S("distortion", "Warp Distortion", ["distortion", "psychedelic"], "Swirling UV distortion of colour bands.", `void main(){ vec2 uv=(gl_FragCoord.xy-0.5*u_res)/u_res.y; float a=atan(uv.y,uv.x), r=length(uv); a+=sin(r*8.0*u_scale-u_time*u_speed)*0.4*u_intensity; float b=sin(a*6.0+r*10.0-u_time*u_speed); gl_FragColor=vec4(pal(b*0.5+0.5)*smoothstep(1.2,0.0,r),1.0);} `);
S("meshGradient", "Shader Mesh Gradient", ["gradient", "saas", "soft"], "GPU mesh gradient with grain.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; float t=u_time*u_speed*0.15; vec2 p1=vec2(0.3+0.2*sin(t),0.3+0.2*cos(t*1.3)), p2=vec2(0.7+0.2*cos(t*0.9),0.6+0.2*sin(t*1.1)), p3=vec2(0.5+0.3*sin(t*0.7),0.9);
 float w1=1.0/(0.02+distance(uv,p1)*distance(uv,p1)*u_scale*4.0), w2=1.0/(0.02+distance(uv,p2)*distance(uv,p2)*u_scale*4.0), w3=1.0/(0.02+distance(uv,p3)*distance(uv,p3)*u_scale*4.0);
 vec3 col=(u_c1*w1+u_c2*w2+u_c3*w3)/(w1+w2+w3); col+=(hash(uv*u_res+u_time)-0.5)*0.05; gl_FragColor=vec4(col*u_intensity,1.0);} `);
S("hologram", "Hologram", ["holographic", "futuristic", "hud"], "Holographic interference with scanlines.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; float s=sin(uv.y*u_res.y*0.7)*0.08; float n=fbm(uv*4.0*u_scale+vec2(0.0,u_time*u_speed*0.3)); float h=fract(uv.x*0.8+uv.y*0.6+n+u_time*u_speed*0.05);
 vec3 col=0.5+0.5*cos(6.2831*(h+vec3(0.0,0.33,0.67))); col=mix(col,pal(n),0.5); gl_FragColor=vec4((col+s)*u_intensity*0.8,1.0);} `);
S("scanline", "CRT Scanlines", ["retro", "crt", "tech"], "Rolling CRT scanlines over gradient.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; vec3 col=pal(uv.y); float l=0.75+0.25*sin(uv.y*u_res.y*1.5); float roll=smoothstep(0.0,0.05,abs(fract(uv.y-u_time*u_speed*0.1)-0.5)); gl_FragColor=vec4(col*l*(0.8+0.2*roll)*u_intensity,1.0);} `);
S("pixel", "Pixel Mosaic", ["pixel", "retro", "gaming"], "Animated pixel mosaic.", `void main(){ float px=24.0*u_scale; vec2 cell=floor(gl_FragCoord.xy/px); float n=noise(cell*0.15+u_time*u_speed*0.3); vec2 f=fract(gl_FragCoord.xy/px); float edge=step(0.08,f.x)*step(0.08,f.y); gl_FragColor=vec4(pal(n)*edge*u_intensity,1.0);} `);
S("dissolve", "Dissolve", ["dissolve", "transition"], "Noise dissolve between two colours.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; float n=fbm(uv*5.0*u_scale); float th=fract(u_time*u_speed*0.15); float e=smoothstep(th,th+0.02,n); float edge=smoothstep(0.04,0.0,abs(n-th)); gl_FragColor=vec4(mix(u_c1,u_c2,e)+u_c3*edge*2.0*u_intensity,1.0);} `);
S("energy", "Energy Plasma", ["energy", "electric", "neon"], "Crackling energy tendrils.", `void main(){ vec2 uv=(gl_FragCoord.xy-0.5*u_res)/u_res.y; vec3 col=vec3(0.0); for(int i=0;i<4;i++){ float fi=float(i); vec2 p=uv*u_scale*2.0; p.x+=fbm(p*1.5+u_time*u_speed*0.4+fi)*0.8; float d=abs(p.y-0.3*sin(p.x*2.0+u_time*u_speed+fi*1.7)+ (fi-1.5)*0.15); col+=pal(fi/3.0)*0.012/d*u_intensity; } gl_FragColor=vec4(col,1.0);} `);
S("heat", "Heat Haze", ["heat", "desert", "warm"], "Rising heat shimmer gradient.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; uv.x+=sin(uv.y*40.0*u_scale-u_time*u_speed*3.0)*0.004*u_intensity*fbm(uv*6.0+u_time); float n=fbm(vec2(uv.x*3.0,uv.y*2.0-u_time*u_speed*0.3)); gl_FragColor=vec4(pal(clamp(uv.y*0.8+n*0.3,0.0,1.0)),1.0);} `);
S("glass", "Glass Refraction", ["glass", "premium", "frosted"], "Fluted glass refraction bands.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; float bands=40.0*u_scale; float fx=fract(uv.x*bands); vec2 ruv=uv+vec2((fx-0.5)*0.06*u_intensity,0.0); float n=fbm(ruv*2.5+u_time*u_speed*0.08); vec3 col=pal(n); col+=pow(1.0-abs(fx-0.5)*2.0,12.0)*0.12; gl_FragColor=vec4(col,1.0);} `);
S("chromatic", "Chromatic Rings", ["chromatic", "prism"], "Chromatic-dispersed concentric rings.", `void main(){ vec2 uv=(gl_FragCoord.xy-0.5*u_res)/u_res.y; float r=length(uv)*10.0*u_scale-u_time*u_speed; vec3 col=vec3(sin(r)*0.5+0.5, sin(r+0.25*u_intensity*4.0)*0.5+0.5, sin(r+0.5*u_intensity*4.0)*0.5+0.5); gl_FragColor=vec4(mix(col,pal(col.r),0.6)*smoothstep(1.0,0.2,length(uv)),1.0);} `);
S("glitchShader", "Digital Glitch", ["glitch", "cyber"], "Block glitch displacement.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; float t=floor(u_time*u_speed*8.0); float blk=hash(vec2(floor(uv.y*20.0),t)); if(blk>0.85) uv.x+=(hash(vec2(t,blk))-0.5)*0.2*u_intensity; float n=fbm(uv*3.0*u_scale); vec3 col=vec3(pal(n+0.02).r, pal(n).g, pal(n-0.02).b); gl_FragColor=vec4(col,1.0);} `);
S("terrain", "Ridge Terrain", ["terrain", "landscape"], "Ridged noise mountain silhouettes.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; vec3 col=mix(u_c3,u_c1,uv.y); for(int i=0;i<4;i++){ float fi=float(i); float h=0.25+fi*0.12+ (1.0-abs(fbm(vec2(uv.x*2.0*u_scale+u_time*u_speed*0.02*(fi+1.0)+fi*7.0,fi))*2.0-1.0))*0.18; if(uv.y<h) col=mix(u_c2*0.3,u_c2,fi/4.0)*(0.6+0.4*u_intensity); } gl_FragColor=vec4(col,1.0);} `);
S("starfieldShader", "Deep Starfield", ["space", "stars"], "GPU starfield with nebula.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res.y; vec3 col=pal(fbm(uv*2.0*u_scale+u_time*0.01))*0.35*u_intensity; for(int i=0;i<3;i++){ float fi=float(i); vec2 g=uv*(40.0+fi*30.0)+vec2(u_time*u_speed*(0.2+fi*0.1),0.0); vec2 id=floor(g); float h=hash(id+fi); vec2 f=fract(g)-0.5; float s=step(0.97,h)*smoothstep(0.08,0.0,length(f))*(0.5+0.5*sin(u_time*3.0+h*40.0)); col+=vec3(s); } gl_FragColor=vec4(col,1.0);} `);
S("auroraShader", "GPU Aurora", ["aurora", "ai", "premium"], "Volumetric aurora curtains.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; vec3 col=vec3(0.0); for(int i=0;i<3;i++){ float fi=float(i); float y=0.55+0.12*sin(uv.x*3.0*u_scale+u_time*u_speed*0.3+fi*2.0)+0.08*fbm(vec2(uv.x*4.0,u_time*0.1+fi)); float d=uv.y-y; col+=pal(fi/2.0)*exp(-abs(d)*(d>0.0?6.0:18.0))*0.7*u_intensity; } gl_FragColor=vec4(col,1.0);} `);
S("tunnel", "Tunnel", ["tunnel", "hypnotic", "energetic"], "Infinite polar tunnel.", `void main(){ vec2 uv=(gl_FragCoord.xy-0.5*u_res)/u_res.y; float a=atan(uv.y,uv.x)/6.2831, r=0.3/length(uv); float v=sin((r+u_time*u_speed)*8.0*u_scale)*0.5+0.5; float s=sin(a*24.0)*0.5+0.5; gl_FragColor=vec4(pal(v*s)*min(1.0,length(uv)*3.0)*u_intensity,1.0);} `);
S("fire", "Fire", ["fire", "warm", "energy"], "Procedural rising flames.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; float n=fbm(vec2(uv.x*4.0*u_scale,uv.y*3.0-u_time*u_speed*1.2)); float f=clamp((1.0-uv.y)*1.4*n*u_intensity*1.5,0.0,1.0); gl_FragColor=vec4(pal(f)*f*1.5,1.0);} `);
S("caustics", "Caustics", ["water", "pool", "calm"], "Underwater light caustics.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res.y*6.0*u_scale; float t=u_time*u_speed*0.4; vec2 p=uv; float c=0.0; for(int i=0;i<4;i++){ p+=vec2(cos(t+p.y*1.3),sin(t+p.x*1.1))*0.4; c+=1.0/length(vec2(sin(p.x),cos(p.y))*6.0); } gl_FragColor=vec4(mix(u_c1,u_c2,0.4)+u_c3*c*0.25*u_intensity,1.0);} `);
S("silk", "Silk", ["silk", "luxury", "fabric"], "Soft flowing silk folds.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; float t=u_time*u_speed*0.2; float f=sin(uv.x*6.0*u_scale+sin(uv.y*3.0+t)*2.0+t)*0.5+0.5; f=pow(f,1.5)+fbm(uv*3.0+t)*0.2; gl_FragColor=vec4(pal(clamp(f,0.0,1.0))*(0.7+0.5*f)*u_intensity,1.0);} `);
S("lava", "Lava Lamp", ["lava", "retro", "blob"], "Smooth metaball lava.", `void main(){ vec2 uv=gl_FragCoord.xy/u_res; uv.x*=u_res.x/u_res.y; float s=0.0; for(int i=0;i<6;i++){ float fi=float(i); vec2 c=vec2(0.9+0.6*sin(u_time*u_speed*0.3+fi*1.7), 0.5+0.4*sin(u_time*u_speed*0.23+fi*2.9)); s+=0.02*u_scale/dot(uv-c,uv-c); } gl_FragColor=vec4(mix(u_c1*0.2,pal(clamp(s*0.25,0.0,1.0)),smoothstep(0.9,1.1,s))*u_intensity,1.0);} `);

/* ---------- Runner ---------- */
type GLState = { gl: WebGLRenderingContext; canvas: HTMLCanvasElement; programs: Map<string, WebGLProgram>; buf: WebGLBuffer } | null;
let state: GLState | undefined;
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  if (state === undefined) init();
  return !!state;
}
function init() {
  try {
    const canvas = getCanvas("__shader_gl", 2, 2);
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }) as WebGLRenderingContext | null;
    if (!gl) { state = null; return; }
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    state = { gl, canvas, programs: new Map(), buf };
  } catch { state = null; }
}
function compile(gl: WebGLRenderingContext, id: string): WebGLProgram | null {
  const preset = SHADERS[id];
  if (!preset) return null;
  const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(`[shader:${id}]`, gl.getShaderInfoLog(s)); return null; } return s; };
  const vs = mk(gl.VERTEX_SHADER, "attribute vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }");
  const fs = mk(gl.FRAGMENT_SHADER, preset.frag);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  return prog;
}
export type ShaderUniforms = { time: number; colors: string[]; speed: number; scale: number; intensity: number; seed: number };
/** Renders a trusted preset to the shared GL canvas and returns it (for drawImage), or null if unavailable. */
export function renderShader(id: string, w: number, h: number, u: ShaderUniforms): HTMLCanvasElement | null {
  if (!webglAvailable() || !state) return null;
  const { gl, canvas } = state;
  const W = Math.max(2, Math.round(w)), H = Math.max(2, Math.round(h));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  let prog = state.programs.get(id);
  if (!prog) { const p = compile(gl, id); if (!p) return null; prog = p; state.programs.set(id, prog); }
  gl.viewport(0, 0, W, H);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const c3 = (i: number) => { const c = parseColor(u.colors[i % u.colors.length] ?? "#ffffff"); return [c.r / 255, c.g / 255, c.b / 255] as const; };
  gl.uniform1f(gl.getUniformLocation(prog, "u_time"), u.time);
  gl.uniform2f(gl.getUniformLocation(prog, "u_res"), W, H);
  gl.uniform3f(gl.getUniformLocation(prog, "u_c1"), ...c3(0));
  gl.uniform3f(gl.getUniformLocation(prog, "u_c2"), ...c3(1));
  gl.uniform3f(gl.getUniformLocation(prog, "u_c3"), ...c3(2));
  gl.uniform1f(gl.getUniformLocation(prog, "u_speed"), u.speed);
  gl.uniform1f(gl.getUniformLocation(prog, "u_scale"), u.scale);
  gl.uniform1f(gl.getUniformLocation(prog, "u_intensity"), u.intensity);
  gl.uniform1f(gl.getUniformLocation(prog, "u_seed"), u.seed % 100);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  return canvas;
}
