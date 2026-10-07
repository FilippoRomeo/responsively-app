import {threeHook} from './three-hook';

// Runs the hook as pages get it (its source text), then plays three.js'
// part: announce a Scene and a WebGLRenderer, render a frame.
describe('threeHook', () => {
  it('finds the live scene, camera and renderer three.js announces', () => {
    const w = window as unknown as Record<string, any>;
    delete w.__RESPONSIVELY_THREE__;
    delete w.__THREE_DEVTOOLS__;

    (0, eval)(`(${threeHook})();`);

    const cube = {
      name: 'Cube',
      type: 'Mesh',
      uuid: 'c',
      position: {toArray: () => [1, 2.00049, 3]},
      children: [],
    };
    const scene = {isScene: true, name: '', type: 'Scene', uuid: 's', children: [cube]};
    const camera = {type: 'PerspectiveCamera'};
    const drawn: unknown[] = [];
    const renderer = {domElement: {}, render: (...args: unknown[]) => drawn.push(args)};
    const announce = (detail: unknown) =>
      w.__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent('observe', {detail}));
    announce(scene);
    announce(renderer);

    const found: unknown[] = [];
    w.__RESPONSIVELY_THREE__.whenReady((f: unknown) => found.push(f));
    expect(found).toEqual([]);
    renderer.render(scene, camera);
    renderer.render(scene, {type: 'OtherCamera'});

    expect(drawn).toHaveLength(2);
    expect(found).toEqual([{scene, camera, renderer}]);
    expect(w.__RESPONSIVELY_THREE__.camera).toBe(camera);
    expect(w.__RESPONSIVELY_THREE__.tree(1)).toEqual({
      name: 'Scene',
      type: 'Scene',
      uuid: 's',
      position: undefined,
      children: [{name: 'Cube', type: 'Mesh', uuid: 'c', position: [1, 2, 3], children: 0}],
    });
  });
});
