# The fonts this page serves itself

Three families, one variable `woff2` each, Latin subset, and the SIL Open Font
License 1.1 text beside the file it covers. They are served from this service's
own origin (`font-src 'self'`), so no viewer ever asks a font host for a glyph.

| family         | upstream                                                                            | Fontsource package                          | file                              | licence                  |
| -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------- | ------------------------ |
| Inter          | The Inter Project Authors (https://github.com/rsms/inter)                           | `@fontsource-variable/inter` 5.3.0          | `inter-latin-wght.woff2`          | `OFL-inter.txt`          |
| Space Grotesk  | The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) | `@fontsource-variable/space-grotesk` 5.3.0  | `space-grotesk-latin-wght.woff2`  | `OFL-space-grotesk.txt`  |
| JetBrains Mono | The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)     | `@fontsource-variable/jetbrains-mono` 5.3.0 | `jetbrains-mono-latin-wght.woff2` | `OFL-jetbrains-mono.txt` |

The families are declared in `../fonts.css`; which of them the page actually asks
for is the `--sans` and `--mono` tokens in `../tokens.css`.

Replacing a file is a matter of dropping the new `woff2` in beside its licence
and leaving the name alone: nothing is generated from these, and nothing in the
repository rewrites them.
