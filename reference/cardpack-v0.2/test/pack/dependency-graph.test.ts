import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseGtsImports,
  parseGtsFields,
  buildImportMap,
  parseJsonAdoptsFrom,
  parseJsonRelationships,
  isExternalModule,
  resolveModulePath,
  resolveJsonRef,
  discoverDependencies,
} from '../../src/pack/dependency-graph.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardpack-dep-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- GTS PARSING ----

describe('parseGtsImports', () => {
  it('extracts named imports', () => {
    const source = `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';`;
    expect(parseGtsImports(source)).toEqual(['https://cardstack.com/base/card-api']);
  });

  it('extracts default imports', () => {
    const source = `import StringField from 'https://cardstack.com/base/string';`;
    expect(parseGtsImports(source)).toEqual(['https://cardstack.com/base/string']);
  });

  it('extracts relative imports', () => {
    const source = `import { Author } from './author';`;
    expect(parseGtsImports(source)).toEqual(['./author']);
  });

  it('extracts multiple imports', () => {
    const source = `
import { CardDef, field } from 'https://cardstack.com/base/card-api';
import { Author } from './author';
import { Tag } from '../tags/tag';
`;
    const modules = parseGtsImports(source);
    expect(modules).toHaveLength(3);
    expect(modules).toContain('https://cardstack.com/base/card-api');
    expect(modules).toContain('./author');
    expect(modules).toContain('../tags/tag');
  });

  it('handles double-quoted imports', () => {
    const source = `import { Foo } from "./foo";`;
    expect(parseGtsImports(source)).toEqual(['./foo']);
  });

  it('returns empty for no imports', () => {
    const source = `export class Foo extends CardDef {}`;
    expect(parseGtsImports(source)).toEqual([]);
  });
});

describe('parseGtsFields', () => {
  it('extracts linksTo fields', () => {
    const source = `@field author = linksTo(Author);`;
    expect(parseGtsFields(source)).toEqual(['Author']);
  });

  it('extracts linksToMany fields', () => {
    const source = `@field tags = linksToMany(Tag);`;
    expect(parseGtsFields(source)).toEqual(['Tag']);
  });

  it('extracts contains fields', () => {
    const source = `@field body = contains(TextBlock);`;
    expect(parseGtsFields(source)).toEqual(['TextBlock']);
  });

  it('extracts containsMany fields', () => {
    const source = `@field items = containsMany(ListItem);`;
    expect(parseGtsFields(source)).toEqual(['ListItem']);
  });

  it('extracts multiple fields', () => {
    const source = `
export class BlogPost extends CardDef {
  @field title = contains(StringField);
  @field author = linksTo(Author);
  @field tags = linksToMany(Tag);
  @field sections = containsMany(Section);
}`;
    const fields = parseGtsFields(source);
    expect(fields).toHaveLength(4);
    expect(fields).toContain('StringField');
    expect(fields).toContain('Author');
    expect(fields).toContain('Tag');
    expect(fields).toContain('Section');
  });

  it('returns empty for no field declarations', () => {
    const source = `export class Simple extends CardDef {}`;
    expect(parseGtsFields(source)).toEqual([]);
  });
});

describe('buildImportMap', () => {
  it('maps named imports to module specifiers', () => {
    const source = `import { Author, Tag } from './cards';`;
    const map = buildImportMap(source);
    expect(map.get('Author')).toBe('./cards');
    expect(map.get('Tag')).toBe('./cards');
  });

  it('maps default imports', () => {
    const source = `import StringField from 'https://cardstack.com/base/string';`;
    const map = buildImportMap(source);
    expect(map.get('StringField')).toBe('https://cardstack.com/base/string');
  });

  it('handles aliased imports', () => {
    const source = `import { Author as BlogAuthor } from './author';`;
    const map = buildImportMap(source);
    expect(map.get('BlogAuthor')).toBe('./author');
    expect(map.has('Author')).toBe(false);
  });

  it('handles multiple import statements', () => {
    const source = `
import { CardDef, field } from 'https://cardstack.com/base/card-api';
import { Author } from './author';
import StringField from 'https://cardstack.com/base/string';
`;
    const map = buildImportMap(source);
    expect(map.get('CardDef')).toBe('https://cardstack.com/base/card-api');
    expect(map.get('field')).toBe('https://cardstack.com/base/card-api');
    expect(map.get('Author')).toBe('./author');
    expect(map.get('StringField')).toBe('https://cardstack.com/base/string');
  });
});

// ---- JSON PARSING ----

describe('parseJsonAdoptsFrom', () => {
  it('extracts module from adoptsFrom', () => {
    const json = {
      meta: { adoptsFrom: { module: '../blog-post', name: 'BlogPost' } },
      attributes: { title: 'Hello' },
    };
    expect(parseJsonAdoptsFrom(json)).toBe('../blog-post');
  });

  it('returns null when no meta', () => {
    expect(parseJsonAdoptsFrom({ attributes: {} })).toBeNull();
  });

  it('returns null when no adoptsFrom', () => {
    expect(parseJsonAdoptsFrom({ meta: {} })).toBeNull();
  });

  it('returns null when module is not a string', () => {
    const json = { meta: { adoptsFrom: { module: 42, name: 'Foo' } } };
    expect(parseJsonAdoptsFrom(json)).toBeNull();
  });
});

describe('parseJsonRelationships', () => {
  it('extracts single relationship', () => {
    const json = {
      relationships: {
        author: { links: { self: '../Author/jane-doe' } },
      },
    };
    expect(parseJsonRelationships(json)).toEqual(['../Author/jane-doe']);
  });

  it('extracts linksToMany numbered keys', () => {
    const json = {
      relationships: {
        'tags.0': { links: { self: '../Tag/tech' } },
        'tags.1': { links: { self: '../Tag/code' } },
      },
    };
    const refs = parseJsonRelationships(json);
    expect(refs).toHaveLength(2);
    expect(refs).toContain('../Tag/tech');
    expect(refs).toContain('../Tag/code');
  });

  it('extracts mixed relationships', () => {
    const json = {
      relationships: {
        author: { links: { self: '../Author/jane' } },
        'tags.0': { links: { self: '../Tag/a' } },
        'tags.1': { links: { self: '../Tag/b' } },
      },
    };
    const refs = parseJsonRelationships(json);
    expect(refs).toHaveLength(3);
  });

  it('returns empty when no relationships', () => {
    expect(parseJsonRelationships({ attributes: {} })).toEqual([]);
  });

  it('skips null relationship values', () => {
    const json = {
      relationships: {
        author: { links: { self: null } },
      },
    };
    expect(parseJsonRelationships(json)).toEqual([]);
  });
});

// ---- MODULE RESOLUTION ----

describe('isExternalModule', () => {
  it('identifies https URLs as external', () => {
    expect(isExternalModule('https://cardstack.com/base/string')).toBe(true);
  });

  it('identifies http URLs as external', () => {
    expect(isExternalModule('http://example.com/card')).toBe(true);
  });

  it('identifies relative paths as local', () => {
    expect(isExternalModule('./author')).toBe(false);
    expect(isExternalModule('../cards/tag')).toBe(false);
  });
});

describe('resolveModulePath', () => {
  it('resolves .gts file', () => {
    const workspace = tmpDir;
    fs.writeFileSync(path.join(workspace, 'author.gts'), 'export class Author {}');

    const result = resolveModulePath('./author', 'blog-post.gts', workspace);
    expect(result).toBe('author.gts');
  });

  it('resolves file in parent directory', () => {
    const workspace = tmpDir;
    fs.writeFileSync(path.join(workspace, 'base-card.gts'), 'export class Base {}');
    fs.mkdirSync(path.join(workspace, 'cards'));

    const result = resolveModulePath('../base-card', 'cards/post.gts', workspace);
    expect(result).toBe('base-card.gts');
  });

  it('resolves .json file', () => {
    const workspace = tmpDir;
    fs.writeFileSync(path.join(workspace, 'config.json'), '{}');

    const result = resolveModulePath('./config', 'index.gts', workspace);
    expect(result).toBe('config.json');
  });

  it('resolves file with explicit extension', () => {
    const workspace = tmpDir;
    fs.writeFileSync(path.join(workspace, 'data.json'), '{}');

    const result = resolveModulePath('./data.json', 'index.gts', workspace);
    expect(result).toBe('data.json');
  });

  it('returns null for non-existent file', () => {
    const result = resolveModulePath('./missing', 'index.gts', tmpDir);
    expect(result).toBeNull();
  });

  it('prefers .gts over .ts', () => {
    const workspace = tmpDir;
    fs.writeFileSync(path.join(workspace, 'card.gts'), 'gts');
    fs.writeFileSync(path.join(workspace, 'card.ts'), 'ts');

    const result = resolveModulePath('./card', 'index.gts', workspace);
    expect(result).toBe('card.gts');
  });
});

describe('resolveJsonRef', () => {
  it('resolves instance reference with .json extension', () => {
    const workspace = tmpDir;
    const instanceDir = path.join(workspace, 'Author');
    fs.mkdirSync(instanceDir);
    fs.writeFileSync(path.join(instanceDir, 'jane-doe.json'), '{}');

    const result = resolveJsonRef('../Author/jane-doe', 'BlogPost/hello.json', workspace);
    expect(result).toBe('Author/jane-doe.json');
  });

  it('returns null for non-existent instance', () => {
    const result = resolveJsonRef('../Author/missing', 'BlogPost/hello.json', tmpDir);
    expect(result).toBeNull();
  });
});

// ---- DEPENDENCY GRAPH WALKER ----

describe('discoverDependencies', () => {
  it('discovers root file only when no deps', () => {
    const workspace = tmpDir;
    fs.writeFileSync(
      path.join(workspace, 'simple.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Simple extends CardDef {}`,
    );

    const result = discoverDependencies('simple.gts', workspace);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe('simple.gts');
    expect(result.files[0].reason).toBe('root');
    expect(result.externalRefs).toHaveLength(1);
    expect(result.externalRefs[0].url).toBe('https://cardstack.com/base/card-api');
  });

  it('follows GTS imports to local files', () => {
    const workspace = tmpDir;

    fs.writeFileSync(
      path.join(workspace, 'author.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Author extends CardDef {}`,
    );

    fs.writeFileSync(
      path.join(workspace, 'blog-post.gts'),
      `import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
import { Author } from './author';
export class BlogPost extends CardDef {
  @field author = linksTo(Author);
}`,
    );

    const result = discoverDependencies('blog-post.gts', workspace);

    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain('blog-post.gts');
    expect(paths).toContain('author.gts');
  });

  it('follows JSON adoptsFrom to GTS definition', () => {
    const workspace = tmpDir;

    fs.writeFileSync(
      path.join(workspace, 'blog-post.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class BlogPost extends CardDef {}`,
    );

    const instanceDir = path.join(workspace, 'BlogPost');
    fs.mkdirSync(instanceDir);
    fs.writeFileSync(
      path.join(instanceDir, 'hello.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: '../blog-post', name: 'BlogPost' } },
        attributes: { title: 'Hello World' },
      }),
    );

    const result = discoverDependencies('BlogPost/hello.json', workspace);

    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain('BlogPost/hello.json');
    expect(paths).toContain('blog-post.gts');
  });

  it('follows JSON relationship links', () => {
    const workspace = tmpDir;

    // Author definition
    fs.writeFileSync(
      path.join(workspace, 'author.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Author extends CardDef {}`,
    );

    // Author instance
    const authorDir = path.join(workspace, 'Author');
    fs.mkdirSync(authorDir);
    fs.writeFileSync(
      path.join(authorDir, 'jane.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: '../author', name: 'Author' } },
        attributes: { name: 'Jane' },
      }),
    );

    // BlogPost definition
    fs.writeFileSync(
      path.join(workspace, 'blog-post.gts'),
      `import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
import { Author } from './author';
export class BlogPost extends CardDef {
  @field author = linksTo(Author);
}`,
    );

    // BlogPost instance with relationship
    const postDir = path.join(workspace, 'BlogPost');
    fs.mkdirSync(postDir);
    fs.writeFileSync(
      path.join(postDir, 'hello.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: '../blog-post', name: 'BlogPost' } },
        attributes: { title: 'Hello' },
        relationships: {
          author: { links: { self: '../Author/jane' } },
        },
      }),
    );

    const result = discoverDependencies('BlogPost/hello.json', workspace);

    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain('BlogPost/hello.json');
    expect(paths).toContain('blog-post.gts');
    expect(paths).toContain('Author/jane.json');
    expect(paths).toContain('author.gts');
  });

  it('follows linksToMany numbered relationship keys', () => {
    const workspace = tmpDir;

    // Tag definition
    fs.writeFileSync(
      path.join(workspace, 'tag.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Tag extends CardDef {}`,
    );

    // Tag instances
    const tagDir = path.join(workspace, 'Tag');
    fs.mkdirSync(tagDir);
    fs.writeFileSync(
      path.join(tagDir, 'tech.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: '../tag', name: 'Tag' } },
        attributes: { label: 'Tech' },
      }),
    );
    fs.writeFileSync(
      path.join(tagDir, 'code.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: '../tag', name: 'Tag' } },
        attributes: { label: 'Code' },
      }),
    );

    // Post definition
    fs.writeFileSync(
      path.join(workspace, 'post.gts'),
      `import { CardDef, field, linksToMany } from 'https://cardstack.com/base/card-api';
import { Tag } from './tag';
export class Post extends CardDef {
  @field tags = linksToMany(Tag);
}`,
    );

    // Post instance with linksToMany
    const postDir = path.join(workspace, 'Post');
    fs.mkdirSync(postDir);
    fs.writeFileSync(
      path.join(postDir, 'hello.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: '../post', name: 'Post' } },
        attributes: {},
        relationships: {
          'tags.0': { links: { self: '../Tag/tech' } },
          'tags.1': { links: { self: '../Tag/code' } },
        },
      }),
    );

    const result = discoverDependencies('Post/hello.json', workspace);

    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain('Post/hello.json');
    expect(paths).toContain('post.gts');
    expect(paths).toContain('tag.gts');
    expect(paths).toContain('Tag/tech.json');
    expect(paths).toContain('Tag/code.json');
  });

  it('handles circular references without infinite loop', () => {
    const workspace = tmpDir;

    // Two cards that reference each other
    fs.writeFileSync(
      path.join(workspace, 'card-a.gts'),
      `import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
import { CardB } from './card-b';
export class CardA extends CardDef {
  @field related = linksTo(CardB);
}`,
    );

    fs.writeFileSync(
      path.join(workspace, 'card-b.gts'),
      `import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
import { CardA } from './card-a';
export class CardB extends CardDef {
  @field related = linksTo(CardA);
}`,
    );

    const result = discoverDependencies('card-a.gts', workspace);

    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain('card-a.gts');
    expect(paths).toContain('card-b.gts');
    expect(paths).toHaveLength(2); // no duplicates
  });

  it('records external references without including them', () => {
    const workspace = tmpDir;

    fs.writeFileSync(
      path.join(workspace, 'card.gts'),
      `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
export class MyCard extends CardDef {
  @field title = contains(StringField);
}`,
    );

    const result = discoverDependencies('card.gts', workspace);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe('card.gts');

    const extUrls = result.externalRefs.map((r) => r.url);
    expect(extUrls).toContain('https://cardstack.com/base/card-api');
    expect(extUrls).toContain('https://cardstack.com/base/string');
  });

  it('skips non-existent referenced files gracefully', () => {
    const workspace = tmpDir;

    fs.writeFileSync(
      path.join(workspace, 'card.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
import { Missing } from './missing';
export class MyCard extends CardDef {}`,
    );

    const result = discoverDependencies('card.gts', workspace);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe('card.gts');
  });

  it('handles deeply nested dependency chains', () => {
    const workspace = tmpDir;

    fs.writeFileSync(
      path.join(workspace, 'base.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Base extends CardDef {}`,
    );

    fs.writeFileSync(
      path.join(workspace, 'middle.gts'),
      `import { Base } from './base';
export class Middle extends Base {}`,
    );

    fs.writeFileSync(
      path.join(workspace, 'leaf.gts'),
      `import { Middle } from './middle';
export class Leaf extends Middle {}`,
    );

    const result = discoverDependencies('leaf.gts', workspace);

    const paths = result.files.map((f) => f.relativePath);
    expect(paths).toContain('leaf.gts');
    expect(paths).toContain('middle.gts');
    expect(paths).toContain('base.gts');
  });

  it('integrates with createArchive via --root', async () => {
    // This test verifies the full integration path
    const { createArchive, listArchive } = await import('../../src/pack/archive.js');

    const workspace = tmpDir;

    // Create a workspace with multiple cards
    fs.writeFileSync(
      path.join(workspace, 'author.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Author extends CardDef {}`,
    );

    fs.writeFileSync(
      path.join(workspace, 'blog-post.gts'),
      `import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
import { Author } from './author';
export class BlogPost extends CardDef {
  @field author = linksTo(Author);
}`,
    );

    // Unrelated card that should NOT be included
    fs.writeFileSync(
      path.join(workspace, 'unrelated.gts'),
      `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Unrelated extends CardDef {}`,
    );

    const archivePath = path.join(tmpDir, 'root-test.cardpack');
    await createArchive({
      sourceDir: workspace,
      outputPath: archivePath,
      rootFile: 'blog-post.gts',
    });

    const { entries } = await listArchive(archivePath);
    const paths = entries.map((e) => e.path);

    expect(paths).toContain('blog-post.gts');
    expect(paths).toContain('author.gts');
    expect(paths).not.toContain('unrelated.gts');
  });

  it('handles invalid JSON files gracefully', () => {
    const workspace = tmpDir;
    fs.writeFileSync(path.join(workspace, 'bad.json'), 'not valid json {{{');

    const result = discoverDependencies('bad.json', workspace);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe('bad.json');
  });

  it('handles GTS file with no matching import for field type', () => {
    const workspace = tmpDir;

    // Field references a locally-defined type (no import needed)
    fs.writeFileSync(
      path.join(workspace, 'card.gts'),
      `import { CardDef, field, contains, FieldDef } from 'https://cardstack.com/base/card-api';

class LocalField extends FieldDef {}

export class MyCard extends CardDef {
  @field data = contains(LocalField);
}`,
    );

    const result = discoverDependencies('card.gts', workspace);
    // Should not crash — LocalField has no import to follow
    expect(result.files).toHaveLength(1);
  });
});
