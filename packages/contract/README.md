# @hexagen-monaco/waves-contract

The `waves/v1` contract for [waves](https://github.com/martinkrakowski/waves): the envelope a project pushes for one wave, its validator, the id patterns, and the staleness and retention rules. Pure TypeScript with no dependencies, so any client or server can validate exactly what the reference server accepts.

```sh
npm install @hexagen-monaco/waves-contract
```

```ts
import { validateEnvelope } from "@hexagen-monaco/waves-contract";

const result = validateEnvelope(JSON.parse(body));
if (!result.ok) {
  // result.errors: [{ path, message }], path an RFC 6901 JSON pointer
}
```

The full contract, with every field and bound, is `docs/waves-v1.md` in the repository.

## Licence

MIT.
