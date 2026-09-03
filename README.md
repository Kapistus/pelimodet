# Field Planner

A tablet-friendly overlay tool for planning airsoft game layouts — starting
points, respawns, mortars, flags, and custom markers — on top of your field
map, with a switchable "main area" / "extended area" view.

## Deploying to GitHub Pages

1. Create a new GitHub repository (or use an existing one).
2. Copy the contents of this folder (`index.html`, `style.css`, `app.js`,
   `assets/`) into the repo root.
3. Commit and push.
4. In the repo's **Settings → Pages**, set the source to your default branch,
   root folder.
5. GitHub will publish it at `https://<your-username>.github.io/<repo-name>/`.

No build step, no dependencies to install — it's plain HTML/CSS/JS.

## Replacing the map images later

If you re-export new versions of the map or the area masks, keep these rules:

- All three files (`pelialue.png`, `default_map.png`, `extended_map.png`)
  must stay **pixel-identical in width and height** to each other.
- The two mask files must be a **white (or any color) shape on a fully
  transparent background** — the shape marks the playable area, and
  transparency is what lets the app tint it any color at any opacity purely
  in code.
- Just overwrite the files in `assets/` with the same filenames — nothing
  else needs to change.

## How saving works

This is a static site with no server, so layouts are saved in two ways:

- **Autosave**: your current work is continuously saved to the browser's
  local storage, so closing the tab or reloading won't lose it.
- **Named layouts** (Save / Load buttons): saved to the same browser's local
  storage under a name you choose. These stay on the device you saved them on.
- **Export / Import**: Export downloads a `.json` file you can back up,
  email, or move to a different tablet; Import loads one back in. This is
  the only way to move a layout between devices or browsers.

## Marker types

- **Starting Point / Respawn Point / Mortar** — fixed icon and color, named
  automatically (numbered if you place more than one).
- **Flag** — color cycles automatically: red, yellow, blue, green, then
  repeats.
- **Custom Marker** — pick a color first with the color swatch in the
  palette, then drag it onto the map; you'll be asked to name it.

Tap any placed marker to rename it, recolor it, or delete it. Drag a placed
marker to reposition it.
