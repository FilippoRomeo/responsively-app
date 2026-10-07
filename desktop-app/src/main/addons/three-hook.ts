/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A page script, run before the page's own scripts. three.js announces every
 * Scene and WebGLRenderer it creates to window.__THREE_DEVTOOLS__; this keeps
 * them, records the camera from the render loop, and exposes them as
 * window.__RESPONSIVELY_THREE__ so tools (compose3d) and agents (evaluate)
 * reach the page's live scene without any change to the project.
 *
 * Runs in the page, not in main: written out as `(${threeHook})()`.
 */
export const threeHook = () => {
  const w = window as any;
  if (w.__RESPONSIVELY_THREE__) return;
  const scenes = new Set<any>();
  const renderers = new Set<any>();
  const waiting: ((found: any) => void)[] = [];
  let last: {scene: any; camera: any; renderer: any} | null = null;
  const settle = () => {
    if (!last) return;
    const found = last;
    waiting.splice(0).forEach((cb) => {
      try {
        cb(found);
      } catch (error) {
        console.error('[three-hook]', error);
      }
    });
  };
  const wrap = (renderer: any) => {
    if (renderer.__responsivelyWrapped) return;
    const render = renderer.render.bind(renderer);
    renderer.__responsivelyWrapped = true;
    renderer.render = (scene: any, camera: any) => {
      // The first frame decides: tools draw extra views with other cameras.
      if (!last) {
        last = {scene, camera, renderer};
        settle();
      }
      return render(scene, camera);
    };
  };
  const hook: EventTarget = w.__THREE_DEVTOOLS__ || new EventTarget();
  hook.addEventListener('observe', (event) => {
    const object = (event as CustomEvent).detail;
    if (object?.isScene) scenes.add(object);
    else if (object?.domElement && typeof object.render === 'function') {
      renderers.add(object);
      wrap(object);
    }
  });
  w.__THREE_DEVTOOLS__ = hook;
  w.__RESPONSIVELY_THREE__ = {
    get scene() {
      return last?.scene ?? [...scenes][0] ?? null;
    },
    get camera() {
      return last?.camera ?? null;
    },
    get renderer() {
      return last?.renderer ?? [...renderers][0] ?? null;
    },
    /** Calls back once the page has rendered a frame (scene, camera and renderer known). */
    whenReady(cb: (found: any) => void) {
      waiting.push(cb);
      settle();
    },
    /** A small summary of the live scene graph, for agents. */
    tree(depth = 4) {
      const walk = (o: any, d: number): any => ({
        name: o.name || o.type,
        type: o.type,
        uuid: o.uuid,
        position: o.position?.toArray().map((n: number) => +n.toFixed(3)),
        children: d > 0 ? o.children.map((c: any) => walk(c, d - 1)) : o.children.length,
      });
      const {scene} = w.__RESPONSIVELY_THREE__;
      return scene ? walk(scene, depth) : null;
    },
  };
};
