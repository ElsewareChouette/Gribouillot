# Gribouillot — version web

Réécriture de Gribouillot en TypeScript, pour le navigateur : rien à installer, et les cartes
et les tracés restent dans le navigateur (IndexedDB), rien n'est envoyé sur un serveur.

Les projets s'échangent avec la version pour ordinateur : on ouvre ici le **dossier** d'un
projet (ou un `.zip` de ce dossier), et « Exporter le projet (.zip) » produit l'arborescence
de la version Qt (`<projet>.grib`, un `<calque>.xml` par calque, la carte et les images).

## Développement

```sh
cd web
npm install
npm run dev      # http://localhost:5173
npm test         # tests unitaires (géométrie, formats .grib / .xml)
npm run build    # typecheck + build statique dans dist/
npm run build:single  # un seul fichier dist-single/gribouillot.html, sans serveur
```

`gribouillot.html` contient tout (code, styles, icônes) : il s'ouvre d'un double-clic, depuis
le disque ou une clé USB, sans connexion. Les projets sont alors gardés par le navigateur pour
ce fichier.

Pas de framework : TypeScript + Canvas 2D, construit avec Vite. Les icônes sont celles de la
version bureau (`../resources/icons`). Le déploiement sur GitHub Pages est fait par
`.github/workflows/web.yml` à chaque push sur `master` qui touche `web/`.

## Organisation

| Fichier | Rôle |
| --- | --- |
| `src/geom.ts` | géométrie plane, conventions d'angles de Qt (`QLineF`) |
| `src/model.ts` | données d'un projet : calques et éléments (immuables) |
| `src/shapes.ts` | spirale à 4 centres, aide au tracé d'arcs, sélection (hit-test) |
| `src/tools.ts` | les outils de construction (machines à états + aperçus) |
| `src/app.ts` | état de l'application, souris/clavier, annuler/rétablir, projets |
| `src/render.ts` | rendu Canvas (épaisseurs indépendantes du zoom) |
| `src/images.ts` | images décodées + copies réduites pour les très grandes cartes |
| `src/legacy.ts` | lecture/écriture `.grib` (INI QSettings, couleurs `@Variant`) et `.xml` |
| `src/io.ts` | import d'un dossier / `.zip`, export `.zip` |
| `src/store.ts` | sauvegarde automatique dans IndexedDB |
| `src/ui/` | menus, barre d'outils, panneau, boîtes de dialogue |

## Différences avec la version bureau

En plus des fonctions de la 2.2 :

- aperçu en direct de toutes les constructions, aimantation sur les points ;
- annuler/rétablir aussi pour les calques (création, suppression, ordre, nom) et les images ;
- calques réordonnables par glisser-déposer ;
- zoom centré sur le curseur, borné, pincement à deux doigts sur écran tactile ;
- angle saisi au clavier ([Entrée]) pour les arcs et les droites à angle ;
- échelle mesurée sur la carte puis saisie de la distance réelle en une étape ;
- export d'image de la carte entière en pleine résolution (pas seulement la vue) ;
- rayon/somme des distances en pixels quand l'échelle n'est pas définie ;
- le GPS (code mort dans la version bureau) n'est pas repris.
