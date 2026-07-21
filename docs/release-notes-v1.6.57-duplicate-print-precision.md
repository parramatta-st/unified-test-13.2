# v1.6.57 — Precise duplicate-print matching

## Fixed

- Printing a Lesson and then a different Revision in the same topic no longer triggers a false duplicate warning.
- Individual prints are now compared by exact material path or material ID.
- Same-folder matching by itself is no longer enough for individual prints.
- Legacy name matching is only used when stable IDs/paths are unavailable, and only within the same folder.
- Folder prints are compared only with previous folder prints using the exact material set.
- A prior individual print no longer blocks a later full-folder print merely because one file overlaps.
- Failed print rows are excluded from duplicate warnings.
- The confirmation message now identifies the exact material for individual prints.
- New logs include `material_path` / `material_paths` to make future matching stable even if catalogue IDs are rebuilt.
