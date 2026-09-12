# Working notes for this repository

## Always preserve final files

**A finished file must never exist only in the scratchpad.** The scratchpad is
wiped whenever the container is rebuilt, and this has already cost real work:
two built client proposals and both of their deal files were lost that way, and
had to be reconstructed from a PDF the client happened to still have.

A file is *final* the moment it is worth showing anyone — a rendered proof, a
proposal PDF, a deal file, a figure manifest, a brief. Before the turn that
produced it ends, it gets out of `/tmp`:

1. **Send it to the user** with `SendUserFile`. That alone puts a copy outside
   the container, and it is never the wrong move.
2. **Commit it** if the repository is allowed to hold it — templates, scripts,
   theme changes, reference documentation, anything reusable.
3. **Ask before pushing client material anywhere external.** Fees, names and
   terms are deliberately kept out of the repository (see below). Moving them
   to Drive, Dropbox or anything else means client data leaving the machine, so
   it is the user's call, not a default.

### The Drive connector creates, it does not replace

Uploading a file that is already there makes a second copy under the same
name rather than a new version of the first. Re-uploading an edited deal file
leaves two, and nothing on either says which is current. Rename the old one —
`update_file` takes a title — before or straight after the new upload.

Binary files cannot go up at all: the connector only takes content inline, so
a PDF has to be base64-encoded through the reply, and anything past about
30 KB exceeds what one message can carry and would arrive truncated. Send
those with `SendUserFile` and let the user drop them in.

### Preserve the source, not just the output

Sort a deliverable into *regenerable* and *irreplaceable* and save the second
first. A proposal PDF rebuilds from its deal file in seconds; the deal file
itself is the only copy of what was agreed. The same split holds elsewhere: the
theme and the build passes are the asset, a rendered book is a product of them.

When something is regenerable, say so and say from what — a file the user knows
they can rebuild is one they do not have to hoard.

## Client material stays out of the repository

`proposals/deals/` and `content/proposal-*/` are gitignored on purpose. Fees,
client names and contract terms belong to the client, and a proposal that has
been sent should not be recoverable from a branch. Licensed fonts are ignored
for the same reason — the repository carries the `@font-face` wiring and the
open-licensed faces, never the licensed file itself.

This rule and the one above pull against each other, and the resolution is
always: preserve it *somewhere the user owns*, and ask which.

## Long builds

The book pipeline paginates the whole document several times per build and
takes roughly half an hour end to end. Start it in the background, wait on a
single watcher rather than polling, and check the render before reporting
anything about it. Numbers quoted from a build log that has not finished are
how a 294-page book got reported as complete when pagination had silently
stopped at page 294 of 305.
