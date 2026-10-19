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
npm run e2e      # test des outils dans Chromium (playwright-core), sur le fichier unique
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
| `src/constructions.ts` | les constructions : étapes de saisie et calcul de la figure (fonctions pures, testées) |
| `src/tools/` | les outils : moteur commun des constructions, sélection, mesure, point, spirale |
| `src/edits.ts` | modifications des calques, en fonctions pures (base de l'annulation) |
| `src/app.ts` | état de l'application, commandes d'édition, annuler/rétablir |
| `src/input.ts` | souris, tactile, clavier |
| `src/session.ts` | ouverture, sauvegarde automatique, import / export d'un projet |
| `src/geo.ts` | calage GPS : Lambert-93, ajustement sur les repères, précision mesurée, lecture des coordonnées |
| `src/places.ts` | recherche de communes (geo.api.gouv.fr, demande internet), listes de villes |
| `src/intersections.ts` | intersections, milieux, extrémités, centres : aimantation et commande [I] |
| `src/links.ts` | constructions liées : un tracé est reconstruit quand ce dont il dépend bouge |
| `src/describe.ts` | texte de la barre d'état sur la sélection (longueurs, angles) |
| `src/render.ts` | rendu Canvas (épaisseurs indépendantes du zoom) |
| `src/images.ts` | images décodées + copies réduites pour les très grandes cartes |
| `src/legacy.ts` | lecture/écriture `.grib` (INI QSettings, couleurs `@Variant`) et `.xml` |
| `src/io.ts` | import d'un dossier / `.zip`, export `.zip` |
| `src/store.ts` | sauvegarde automatique dans IndexedDB |
| `src/ui/` | menus, barre d'outils, panneau, boîtes de dialogue |

## Différences avec la version bureau

En plus des fonctions de la 2.2 :

- aperçu en direct de toutes les constructions ;
- aimantation sur les points, et aussi sur les intersections, les milieux et extrémités des
  segments, les centres (option du menu Affichage) ; [I] place les points d'intersection
  des éléments sélectionnés ;
- constructions liées : avec l'outil Sélection, on glisse un point et ce qui est construit
  dessus suit (droites, cercles, arcs, points d'intersection…), voir ci-dessous ;
- villes placées par leur nom, avec leur poids (Édition → Placer des villes par leur nom) ;
- annuler/rétablir aussi pour les calques (création, suppression, ordre, nom) et les images ;
- calques réordonnables par glisser-déposer ;
- zoom centré sur le curseur, borné, pincement à deux doigts sur écran tactile ;
- angle saisi au clavier ([Entrée]) pour les arcs et les droites à angle ;
- échelle mesurée sur la carte puis saisie de la distance réelle en une étape ;
- export d'image de la carte entière en pleine résolution (pas seulement la vue) ;
- rayon/somme des distances en pixels quand l'échelle n'est pas définie ;
- position GPS de n'importe quel point (voir ci-dessous).

## Position GPS

Panneau *Position GPS* : on clique des villes de la carte et on donne leur nom (recherche
de la commune sur geo.api.gouv.fr, position de sa mairie) ou leurs coordonnées. À partir de
2 repères, la barre d'état affiche la latitude et la longitude du curseur, et le panneau
celles du point ou du centre de cercle sélectionné (copie, liens Géoportail et
OpenStreetMap, nom de la commune).

La carte est ajustée sur le Lambert-93 (similitude, affine ou polynomiale de degré 2 : la plus
simple qui ne soit pas nettement moins bonne). La précision affichée est mesurée : chaque
repère est replacé par les autres, et son écart (trait rouge sur la carte) dit à quoi s'en
tenir pour un point quelconque. Un repère nettement plus loin que les autres est presque
toujours une erreur d'identification.

Sur le scan de la Michelin 989 de Zarquos (`tests/fixtures/zarquos-989.json`, 42 communes
visées au centre de leur rond) : écart type 0,4 km, au pire 1,1 km ; avec 10 communes
seulement, 0,6 km sur les 32 autres. Ce scan fait 128,5 m par pixel, pas 127.

Édition → *Placer des villes par leur nom* : une liste de communes, une par ligne, avec si
besoin le département entre parenthèses et un poids (« Clisson ; 3 », « Saint-Pierre (44) 2 »).
Chaque nom est vérifié (homonymes au choix, noms approchés signalés), puis la commune est placée
à la position de sa mairie, avec son nom affiché à côté du point.

Les repères sont exportés à côté du `.grib`, dans `<projet>.web.json`, que la version bureau
ignore.

## Constructions liées

Chaque tracé fait avec un outil retient d'où viennent ses données : un point cliqué, une
intersection, un milieu, un centre, un élément de référence, une longueur ou un angle saisis.
Quand on glisse un point (outil Sélection, calque courant), tout ce qui en dépend est
reconstruit dans l'ordre de création. Ne suivent que les données prises sur la figure : un
clic dans le vide reste une position fixe. Un point construit (intersection…) ne se glisse
pas, il suit ses éléments. Changer l'angle d'un arc à la main ([A]) le détache.

Ces liens et les identifiants des éléments sont écrits dans les `.xml`, en attributs `wid` et
`link` que la version bureau ne lit pas (elle les perd si elle réenregistre le calque : les
tracés restent, sans lien).
