# Third-party notices

Graphe is built on other people's work. This file records the licences of the software we
redistribute in the Graphe application bundle, as those licences require.

**Graphe is not a fork.** We depend on these projects as published packages and have not modified
their source. Graphe is not affiliated with, endorsed by, or sponsored by any of the projects below.
Their names and marks belong to their respective owners.

---

## Pi

The agent runtime at the heart of Graphe. Graphe would not exist without it.

- Project: <https://github.com/earendil-works/pi>
- Website: <https://pi.dev>
- Packages used: `@earendil-works/pi-coding-agent`, and its dependencies
- Licence: MIT

```
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

"THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT ANY KIND OF WARRANTY, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT."

In no event shall the authors or copyright holders be held responsible for any claim, damages,
or other liability, whether in an action of contract, tort, or otherwise, arising from, out of,
or in connection with the software or the use or other dealings in the software.
```

---

## Everything else

React, Vite, and the rest of the runtime dependencies ship under MIT or similarly permissive
licences. A complete, generated manifest of every bundled package and its licence text is produced
at build time and included in the distributed application.

> **TODO before the first public release:** wire `scripts/third-party-licenses.mjs` into the build so
> this manifest is generated from the actual dependency tree rather than maintained by hand. A
> hand-maintained list goes stale, and a stale licence file is a compliance problem, not a tidiness
> one.
