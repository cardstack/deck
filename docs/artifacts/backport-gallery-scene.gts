import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
// Platform RRI — VirtualNetwork maps @cardstack/base/ → pinned Version.
import { CardDef, Component, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
// Bare import — answered by the realm decklist pin (see backport-remix-decklist.json).
// This module’s RRI is @workspace/acme/gallery/scene → three@0.169.0.
// @workspace/acme/gallery/legacy-viewer/scene can import 'three' too → 0.160.0 via scopes.
import * as THREE from 'three';

export class GalleryScene extends CardDef {
  static displayName = 'Gallery Scene';

  @field title = contains(StringField);
  @field mood = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section class='scene'>
        <h1>{{@model.title}}</h1>
        <p class='dim'>three r{{this.revision}} · mood {{@model.mood}}</p>
        <canvas {{this.mount}}></canvas>
      </section>
      <style scoped>
        .scene { padding: 1rem; }
        .dim { opacity: 0.6; font: 12px/1.4 ui-monospace, monospace; }
        canvas { width: 100%; max-width: 640px; height: 360px; display: block; }
      </style>
    </template>

    @tracked revision = THREE.REVISION;

    mount = (element: HTMLCanvasElement) => {
      let renderer = new THREE.WebGLRenderer({ canvas: element, antialias: true });
      let scene = new THREE.Scene();
      // …
      return () => renderer.dispose();
    };
  };
}
