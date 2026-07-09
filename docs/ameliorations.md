# Gribouillot — pistes d'amélioration

Audit réalisé le 2026-07-09 (v2.2.1) à partir du code, du manuel utilisateur et du
workflow chouetteur. Ce document sert de backlog : chaque amélioration est
indépendante, à cocher quand elle est faite, avec les fichiers concernés et
comment la tester.

## Points forts à préserver

- Construction géométrique guidée pas-à-pas dans la barre de statut (`drawingTips`).
- Échelle km/px précise, mesures passives riches à la sélection (longueurs,
  angle entre 2 droites, distances point-droite/cercle) — `sceneSelectionChanged`,
  `gribouillot_toolbar.cpp`.
- Calques = protection : on peut se référencer aux tracés d'un autre calque sans
  pouvoir les modifier.
- Spirale à 4 centres (spécifique chasse à la Chouette d'Or).
- Import d'images avec rotation (flèches, ±1°/±10°), échelle (+/-, Maj+molette,
  presets 0/1/2) et transparence par calque.

## Constats

### Le plus grave : aucun undo
- Pas de `QUndoStack` dans le code. `Suppr` détruit définitivement
  (`deleteSelectedItems`, `gribouillotlayer.cpp:369`).
- Supprimer un calque efface immédiatement son fichier XML du disque
  (`gribouillotlayer.cpp:459-476`).

### Ergonomie
- Figures non déplaçables après création (`ItemIsMovable` seulement sur les
  images, `item_pixmap.cpp:27`). Un cercle mal placé = supprimer + redessiner.
- Échec **silencieux** des outils à référence (parallèle, perpendiculaire,
  tangente, cercle-depuis-rayon...) quand le clic ne sélectionne pas le bon
  item : le garde `isOnlySelected` échoue sans message
  (`gribouillot_toolbar.cpp:60-96`).
- Réarmement incohérent : segment/cercle/arc/ellipse/spirale se désarment après
  une figure ; parallèle/perpendiculaire/tangente restent armés « pour dessiner
  en série » ; point/horizontale/verticale restent armés implicitement.
- Zoom : pas de borne min/max (`zoomablegraphicsview.cpp` `wheelEvent`), pas
  d'affichage du niveau, pas de raccourci « ajuster »/« 100 % » (le
  `zoomToFit()` existe mais n'est appelé qu'au chargement), zoom centré sur la
  vue et non sur le curseur.
- Aucun raccourci clavier pour les outils de dessin. Tooltip de la flèche de
  sélection annonce `{s}` mais le raccourci réel est `J` (et `S` = options
  spirale).
- Calques non réordonnables : `setMovable(true)` commenté
  (`gribouillottabwidget.cpp:19`) à cause d'un bug Qt5 d'époque — l'ordre est
  pourtant persisté dans le `.grib` (`layersOrder`).

### Fonctionnalités absentes
- **Texte/annotation** : rien. Impossible d'écrire une hypothèse sur la carte ou
  de nommer un point (seul contournement : la pondération des points).
- **Mesures volatiles** : distance/angle uniquement en barre de statut, rien
  d'épinglable sur la carte.
- **Export limité** : `actionExportAs` fait un `grab()` du viewport à la
  résolution écran (`gribouillot.cpp:963-980`). Pas de rendu pleine carte.
- **GPS : code mort.** Bouton caché (`//TODO: implement GPS`,
  `gribouillot.cpp:146`), `getFix()` renvoie "no data"
  (`dlg_setupgps.cpp:33-37`), pas de conversion px↔lat/long.
- Zoom/position non sauvegardés dans le projet.
- Pas de copier/coller ni de déplacement d'items entre calques.
- Pas de rectangle/polygone/main levée.

### Dette technique (au fil de l'eau)
- Fuites mémoire dans la conversion noir & blanc : `mapImage`/`bwMapImage`
  jamais libérés, tableau `std::thread[]` jamais `delete[]`
  (`gribouillot.cpp:1126-1164`).
- `break` manquant après le case `PROTRACTOR`
  (`gribouillot_toolbar.cpp:410-412`) — bénin (tombe dans NONE).
- Typos et chaînes hors `tr()` (ex. "Maj" en dur, `item_arc.cpp:96`).
- Valeurs codées en dur : monde ±50000px pour les droites « infinies »,
  cycle d'épaisseurs 1/3/5/7, limite image Qt 512 Mo.

## Backlog priorisé

Chaque item est autonome et testable séparément. Cocher quand fait.

### Priorité 1 — sécurité du travail et confort immédiat

- [ ] **1. Undo/redo (Ctrl+Z / Ctrl+Y)** — effort : moyen/gros
  - `QUndoStack` dans `Gribouillot`, commandes pour création et suppression
    d'items (minimum viable), puis étendre (couleur, épaisseur, déplacement).
  - Corbeille pour la suppression de calque : renommer le XML en `.xml.bak` au
    lieu d'effacer.
  - Fichiers : `gribouillot.h/.cpp`, `gribouillotlayer.cpp`, nouveau
    `src/app/commands.h/.cpp`.
  - Test : dessiner, Suppr, Ctrl+Z → l'item revient ; supprimer un calque →
    fichier .bak présent.

- [ ] **2. Zoom ergonomique** — effort : faible
  - `setTransformationAnchor(AnchorUnderMouse)` ; bornes min/max de zoom ;
    raccourci `F` = ajuster la carte (réutiliser `zoomToFit()`), `1` = 100 % ;
    afficher le niveau de zoom (il n'apparaît que sur la barre d'échelle).
  - Fichiers : `zoomablegraphicsview.cpp/h`, `gribouillot.ui` (actions).
  - Test : zoomer molette sur un coin → le point sous le curseur ne bouge pas ;
    F/1 fonctionnent ; impossible de zoomer à l'infini.

- [ ] **3. Feedback des échecs silencieux** — effort : faible
  - Dans chaque garde `isOnlySelected(...)` qui échoue, afficher en barre de
    statut pourquoi (« Sélectionnez d'abord une droite ou un segment »).
  - Fichiers : `gribouillot_toolbar.cpp` (cases PARALLEL, PERPENDICULAR,
    TANGENT_TOCIRCLE, CIRCLE_FROMSELECTEDRADIUS/DIAMETER, ARC_FROMCIRCLE...).
  - Test : armer « perpendiculaire », cliquer dans le vide → message clair.

### Priorité 2 — forte valeur chouetteur

- [ ] **4. Outil texte/étiquette** — effort : moyen
  - Nouvel `Item_text` (QGraphicsTextItem dérivé), persisté dans le XML de
    calque, éditable (double-clic), couleur du calque.
  - Fichiers : nouveau `src/items/item_text.*`, `gribouillotitem.h`,
    `gribouillotlayer.cpp` (write/loadXML), toolbar.
  - Test : poser un texte, sauvegarder, rouvrir → le texte est là.

- [ ] **5. Mesures épinglables** — effort : moyen
  - Après une mesure (distance/angle), proposer d'épingler le résultat comme
    étiquette persistante sur la carte (dépend de l'item texte du n°4).
  - Test : mesurer 157 km, épingler, rouvrir le projet → l'étiquette est là.

- [ ] **6. Export pleine résolution** — effort : faible/moyen
  - Rendre la scène complète (`QGraphicsScene::render` dans un QImage à la
    taille de la carte) au lieu du `grab()` du viewport ; proposer viewport ou
    carte entière dans le dialogue.
  - Fichiers : `gribouillot.cpp` (`on_actionExportAs_triggered`).
  - Test : exporter → l'image fait la taille de la carte, tracés inclus, pas de
    barres de défilement.

- [ ] **7. Réordonnancement des calques** — effort : faible (si le bug Qt a disparu)
  - Réactiver `setMovable(true)` (`gribouillottabwidget.cpp:19`), tester en Qt6,
    synchroniser `layersOrder` à la sauvegarde (déjà persisté).
  - Test : déplacer des onglets, sauvegarder, rouvrir → ordre conservé, pas de
    crash en déplaçant autour de l'onglet carte et du « + ».

### Priorité 3 — chantiers ambitieux

- [ ] **8. Géoréférencement réel** — effort : gros
  - Calage par 2 points connus → conversion px↔lat/long ; saisie de coordonnées
    pour placer un point ; export GPX des points. Finir ou retirer le code GPS
    mort (`dlg_setupgps.cpp`).
  - Test : caler sur 2 villes, placer un point par coordonnées → position
    correcte ; export GPX lisible par un GPS/appli.

- [ ] **9. Figures déplaçables/éditables** — effort : moyen/gros
  - `ItemIsMovable` optionnel (mode « édition »), ou déplacement fin aux flèches
    de l'item sélectionné ; attention à l'esprit « précision » de l'outil
    (positions calculées). À coupler avec l'undo (n°1).

- [ ] **10. Divers**
  - Sauvegarder zoom/pan dans le `.grib` et restaurer à l'ouverture.
  - Copier/dupliquer des items, déplacer un item vers un autre calque.
  - Outil polygone / main levée.
  - Nettoyage dette technique (fuites B&W, `break` PROTRACTOR, typos, `tr()`).

## Méthode de travail

1 amélioration = 1 branche courte ou 1 commit isolé sur `master` + test manuel
(section « Test » de l'item) + release mineure quand un lot cohérent est prêt.
Le CI construit les binaires 3 plateformes à chaque tag `v*`.
