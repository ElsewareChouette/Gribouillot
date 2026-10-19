# Gribouillot — version web

Réécriture de Gribouillot en TypeScript, pour le navigateur : rien à installer, et les cartes
et les tracés restent dans le navigateur (IndexedDB), rien n'est envoyé sur un serveur.

Les projets s'échangent avec la version pour ordinateur : on ouvre ici le **dossier** d'un
projet (ou un `.zip` de ce dossier), et « Exporter le projet (.zip) » produit l'arborescence
de la version Qt (`<projet>.grib`, un `<calque>.xml` par calque, la carte et les images).

## L'interface

- **En haut** : les menus, le projet, le bandeau des énigmes (530 → 520, dans l'ordre du jeu),
  annuler/rétablir et la recherche **Ctrl+K** : une commande, un outil, un calque ou un objet
  par quelques lettres (« perp », « Dabo »).
- **À gauche**, 7 outils : Sélection, Vue, Point, Droite, Cercle, Arc, Mesure. Leurs variantes
  (13 droites, 7 cercles, report de distance…) sont dans la **barre d'options** au-dessus de
  la carte, avec la couleur, l'épaisseur et les réglages utiles à l'outil.
- **À droite** (400 px, réglable en glissant son bord), 3 onglets : **Énigmes** (ou Calques), **Objet** (tout sur la sélection : nom,
  construction et chaîne de dépendances, mesures carte et terrain, azimuts, précision, position
  GPS, alentours, annotation, style ; et pour plusieurs objets : triangle d'erreur, traversée des
  zones) et **Carte** (fond, échelle, unités, nord, calage GPS).
- Les nouveaux objets sont **nommés** (A, B…, d1, c1…) ; les noms des points s'affichent.
- Les points font toujours 10 pixels à l'écran, quelle que soit l'épaisseur (gardée dans le fichier pour la version bureau).

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
| `src/monuments.ts` | monuments historiques (base Mérimée) autour d'un point ou le long d'une droite |
| `src/links.ts` | constructions liées : un tracé est reconstruit quand ce dont il dépend bouge |
| `src/units.ts` | longueurs en formules et en unités du jeu (mm, cm de carte ; m, km, mesures), azimuts et points cardinaux |
| `src/names.ts` | noms des objets, construction en mots, dépendances |
| `src/enigmas.ts` | les énigmes : groupes de calques dans l'ordre du jeu, règles (pas de référence vers une énigme suivante) |
| `src/analysis.ts` | triangle d'erreur, traversée des zones |
| `src/geojson.ts` | export des tracés en coordonnées GPS |
| `src/calibrations.ts` | cartes connues (scan Zarquos de la 989) : calage et échelle par défaut |
| `src/describe.ts` | texte de la barre d'état sur la sélection (longueurs, angles) |
| `src/render.ts` | rendu Canvas (épaisseurs indépendantes du zoom) |
| `src/images.ts` | images décodées + copies réduites pour les très grandes cartes |
| `src/legacy.ts` | lecture/écriture `.grib` (INI QSettings, couleurs `@Variant`) et `.xml` |
| `src/io.ts` | import d'un dossier / `.zip`, export `.zip` |
| `src/store.ts` | sauvegarde automatique dans IndexedDB |
| `src/ui/` | barre du haut et rail d'outils (`shell`, `toolbox`), panneau (`panel`, `inspector`), commandes et Ctrl+K (`commands`), boîtes de dialogue |

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
Chaque nom est vérifié (homonymes au choix, noms approchés et villes hors carte signalés, toutes
les communes trouvées cochées), puis la commune est placée à la position de sa mairie. Son nom
reste dans l'objet (onglet Objet, Ctrl+K, constructions) sans être écrit sur la carte ; pour y
écrire un nom, le mettre devant avec « = » (`A = Angers ; 0`), dans la colonne « Nom sur la
carte », ou par « Nommer d'après le poids » (0 → A, 1 → B…, le code de la 580).

Un point (ou un cercle) sélectionné : *Autour de ce point…* liste les monuments historiques à
moins de 0,25 à 20 km, filtrables par nature (église, croix, dolmen…), par date de protection
(en 1993 ou avant) et par texte, avec leur fiche (POP), une recherche Google et Géoportail ;
puis, à moins de 2 km, les lieux-dits et sites de l'IGN (data.geopf.fr). Une droite ou un
segment sélectionné : les monuments dans une bande de part et d'autre, dans l'ordre le long de
la droite. Chaque résultat peut être placé comme point nommé.

La base Mérimée (ministère de la Culture, licence ouverte) est compactée par
`npm run data:merimee` dans `public/data/merimee.json` (44 377 monuments situés, 1,2 Mo
compressé), publiée avec le site et téléchargée au premier usage ; la page ouverte depuis le
disque la prend sur le site.

Cartes connues (`src/calibrations.ts`) : une carte reconnue à sa taille exacte reçoit son calage
par défaut quand le projet n'en a pas, ainsi que son échelle si elle n'est pas définie. C'est le
cas du scan Zarquos de la 989 (8460 × 7570 px, 31 villes calées par l'utilisateur : 0,5 km
d'écart typique). Le panneau propose de revenir à ce calage par défaut.

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

## Énigmes, unités, analyse

**Énigmes.** On travaille par énigmes par défaut : un nouveau projet commence dans la 530, et
un projet qui n'en a jamais eu (venu de la version bureau) est rangé par énigmes à
l'ouverture, ses calques « 500 … » dans la 500, les autres hors énigme. Un groupe de calques par énigme (530,
780, 470, 580, 600, 500, 420, 560, 650, 520), avec sa couleur (celle des nouveaux tracés) ;
« + Ajouter un calque » en crée un autre dans l'énigme (points, hypothèse A…). Un clic sur une énigme du bandeau y fait
travailler ; *état à cette énigme* masque les suivantes. En dessinant dans une énigme, on ne
s'accroche pas aux objets des énigmes suivantes. L'ordre se change (↑ ↓). Les groupes sont dans
le `.web.json` ; la version bureau voit des calques ordinaires (« 500 constructions »).

**Unités.** Les tracés se font sur la feuille, à l'échelle de la carte (1 px = 127 m pour le
scan Zarquos) ; le calage GPS donne la distance sur le terrain (géodésique, GRS80), affichée à
côté avec l'écart (+1,2 % sur ce scan). Les longueurs se saisissent en formules : `560606
mesures`, `18,5 cm`, `86164/46241860 * 300000 km` (mm et cm sur la carte ; m, km et mesures
sur le terrain), et la formule reste dans la construction. Les directions : azimut, point
cardinal (`sud-ouest`), cap (`N 30° E`), depuis le haut de la feuille ou le méridien local
(onglet Carte). Une longueur proche ou sous la précision de lecture (± 0,3 mm) est signalée.

**Analyse.** Plusieurs droites sélectionnées : leur triangle d'erreur, sa taille et son centre,
traçables (liés). Une droite et des cercles : quelles zones elle traverse, de combien. Chaque
objet peut porter une annotation (citation, madit, doute).

**Exports.** Image (vue ou carte entière) avec légende des énigmes, échelle et nord, dans l'état
affiché ; GeoJSON des tracés en coordonnées GPS (QGIS, uMap, geojson.io).
