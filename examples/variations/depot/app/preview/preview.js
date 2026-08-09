// One sealed page, rendered with whatever the import map resolved to.
//
// This file never mentions a variant. The chooser iframes it four times —
// once plain and once per variation, each with a different `?with=` — and the
// only thing that differs between those renders is what the SERVER resolved
// one bare specifier to, for that one request.
//
// It imports `app/gallery` by name rather than reaching for a sibling file,
// which is what makes the composition layer swappable too: `?with=` can only
// redirect a specifier, never a relative path.
import { gallery } from 'app/gallery';

document.getElementById('out').innerHTML = await gallery();
