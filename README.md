# Gribouillot
Un logiciel pour tracer des figures géométriques sur une carte, avec un système de calques et des
fonctionnalités puissantes. Il a été créé à l'origine pour aider les chercheurs de la Chouette
d'Or, la célèbre chasse au trésor française.

## À propos de ce fork

Ce dépôt est un **fork activement maintenu** de
[Fr3nchK1ss/Gribouillot](https://github.com/Fr3nchK1ss/Gribouillot), le projet original de
Ludovic A., dont la dernière activité remonte à **octobre 2020 (version 2.0)**.

Il est maintenu par **Elseware**, un chouetteur qui utilise Gribouillot et souhaitait le faire
vivre et continuer à l'améliorer. Le projet d'origine ne semblant plus maintenu, le
développement se poursuit ici plutôt que par des pull requests vers le dépôt parent.
La démarche pour faire vivre l'outil :

- **Modernisation** : portage vers Qt6 (Qt5 reste supporté), corrections pour les systèmes actuels ;
- **Nouvelles fonctionnalités** : par exemple l'outil de tracé d'*ellipse par les foyers* ;
- **Distribution** : binaires Linux, Windows et macOS construits automatiquement par GitHub Actions
  (voir les [Releases](https://github.com/ElsewareChouette/Gribouillot/releases)) ;
- Même licence GPL3 que le projet original.

Toute remarque, signalement de bug ou suggestion est bienvenu : n'hésitez pas à ouvrir une
issue sur ce dépôt.

## Installation

Trois possibilités :

- **utiliser la version web**, sans rien installer : ouvrez
  **<https://elsewarechouette.github.io/Gribouillot/>** dans votre navigateur
  (version alpha, voir [Version web](#version-web-alpha)) ;
- **installer les binaires** prêts à l'emploi de la version bureau (voir ci-dessous) ;
- **compiler** la version bureau depuis les sources (voir [Compilation](#compilation)).

### Installer les binaires

Téléchargez le fichier correspondant à votre système depuis la
**[dernière release](https://github.com/ElsewareChouette/Gribouillot/releases/latest)** :

| Système | Fichier |
|---|---|
| Linux (x86_64) | `Gribouillot-linux-x86_64.AppImage` |
| Windows (64 bits) | `Gribouillot-windows-x64.zip` |
| macOS (Apple Silicon : M1, M2…) | `Gribouillot-macos-arm64.dmg` |

Ces binaires sont construits automatiquement à partir des sources par le
[workflow CI](.github/workflows/build.yml). Toutes les versions sont listées sur la
[page des Releases](https://github.com/ElsewareChouette/Gribouillot/releases).

#### Linux

L'AppImage est un fichier unique qui contient tout ce qu'il faut ; il suffit de le rendre
exécutable puis de le lancer :
```bash
chmod +x Gribouillot-linux-x86_64.AppImage
./Gribouillot-linux-x86_64.AppImage
```
Si le lancement échoue avec une erreur mentionnant FUSE, installez la bibliothèque `libfuse2` :
```bash
sudo apt install libfuse2      # Ubuntu 22.04, Debian 12
sudo apt install libfuse2t64   # Ubuntu 24.04 et plus récent
```

#### Windows

1. Décompressez `Gribouillot-windows-x64.zip` dans le dossier de votre choix
   (clic droit → « Extraire tout… »).
2. Lancez `gribouillot.exe` depuis ce dossier.

Le programme n'étant pas signé, Windows SmartScreen peut afficher un avertissement au premier
lancement : cliquez sur « Informations complémentaires » puis « Exécuter quand même ».

#### macOS

1. Ouvrez `Gribouillot-macos-arm64.dmg` et faites glisser `gribouillot.app` dans le dossier
   **Applications**.
2. L'application n'étant ni signée ni notarisée par Apple, macOS bloque le premier lancement.
   Essayez de l'ouvrir une première fois, puis allez dans **Réglages Système → Confidentialité
   et sécurité** et cliquez sur « Ouvrir quand même ». Alternative en ligne de commande :
   ```sh
   xattr -dr com.apple.quarantine /Applications/gribouillot.app
   ```

Le binaire fourni ne fonctionne que sur les Mac Apple Silicon. Sur un Mac Intel, compilez le
logiciel (voir ci-dessous).

#### Anciennes versions

Les binaires 2.0 historiques construits par le projet d'origine (Qt5, 2018-2020) ont été retirés
du dépôt ; ils restent disponibles dans le
[projet d'origine](https://github.com/Fr3nchK1ss/Gribouillot/tree/master/bin) et dans
l'historique git de ce dépôt.

## Version web (alpha)

**À utiliser en ligne : <https://elsewarechouette.github.io/Gribouillot/>**

Une réécriture en TypeScript qui fonctionne dans le navigateur : rien à installer, les cartes et
les dessins restent dans le navigateur (rien n'est envoyé sur un serveur). Elle ouvre les
dossiers de projet de la version bureau (ou un `.zip` de ceux-ci) et exporte dans le même format
`.grib` + `.xml` : on peut donc passer d'une version à l'autre avec les mêmes projets.

Elle peut aussi être construite en un seul fichier `gribouillot.html`, qui s'ouvre d'un
double-clic sans serveur ni connexion (`npm run build:single`, voir le
[README de la version web](web/README.md)).

Le code se trouve dans [`web/`](web/README.md). Le site est mis à jour automatiquement sur
GitHub Pages par le [workflow web](.github/workflows/web.yml) à chaque modification de `web/`
sur la branche `master`.

## Compilation

### Linux (Ubuntu/Debian)

#### Prérequis
Installez les outils de développement Qt6 et les dépendances :
```bash
sudo apt update
sudo apt install qt6-base-dev qt6-tools-dev qt6-tools-dev-tools build-essential
```

Pour Qt5 (alternative) :
```bash
sudo apt install qtbase5-dev qt5-qmake qttools5-dev-tools build-essential
```

#### Compilation
1. Clonez le dépôt :
```bash
git clone https://github.com/ElsewareChouette/Gribouillot.git
cd Gribouillot
```

2. Générez le Makefile avec qmake :
```bash
qmake6 gribouillot.pro
# Ou pour Qt5 : qmake gribouillot.pro
```

3. Compilez le projet :
```bash
make -j$(nproc)
```

4. Lancez l'application :
```bash
./bin/gribouillot
```

### Windows

#### Prérequis
1. Téléchargez et installez Qt6 depuis le site officiel :
   - Rendez-vous sur https://www.qt.io/download-qt-installer
   - Téléchargez le Qt Online Installer
   - Pendant l'installation, sélectionnez Qt 6.x pour votre compilateur (MinGW ou MSVC)
   - Installez aussi Qt Creator (facultatif mais recommandé)

2. Installez un compilateur C++ :
   - **Option A - MinGW** (fourni avec l'installateur Qt)
   - **Option B - Visual Studio** (à télécharger sur le site de Microsoft)

#### Compilation avec Qt Creator (recommandé)
1. Ouvrez Qt Creator
2. Cliquez sur « Ouvrir un projet » et sélectionnez `gribouillot.pro`
3. Configurez le projet avec le kit Qt installé
4. Cliquez sur le bouton « Compiler » (icône marteau) ou appuyez sur Ctrl+B
5. Cliquez sur le bouton « Exécuter » (triangle vert) ou appuyez sur Ctrl+R

#### Compilation en ligne de commande
1. Ouvrez l'invite de commandes Qt (menu Démarrer → Qt → Qt 6.x)

2. Placez-vous dans le dossier du projet :
```cmd
cd chemin\vers\Gribouillot
```

3. Générez le Makefile :
```cmd
qmake gribouillot.pro
```

4. Compilez :
   - Avec MinGW :
   ```cmd
   mingw32-make
   ```
   - Avec MSVC (Visual Studio) :
   ```cmd
   nmake
   ```

5. Lancez l'application :
```cmd
bin\gribouillot.exe
```

### macOS

#### Prérequis
Installez Qt avec Homebrew :
```sh
brew install qt
```

Pour Qt5 (alternative) :
```sh
brew install qt@5
export PATH="$(brew --prefix qt@5)/bin:$PATH"
```

#### Compilation
1. Placez-vous dans le dossier du projet et générez le Makefile :
```sh
qmake gribouillot.pro
```

2. Compilez le projet :
```sh
make -j$(sysctl -n hw.ncpu)
```

3. Lancez l'application :
```sh
open bin/gribouillot.app
```

## Structure du projet
- **Fichiers sources** : fichiers `*.cpp` contenant l'implémentation
- **Fichiers d'en-tête** : fichiers `*.h` contenant les déclarations de classes
- **Fichiers UI** : fichiers `*.ui` décrivant l'interface pour Qt Designer
- **Ressources** : `gribouillot.qrc` pour les ressources de l'application (icônes, images)
- **Traductions** : `gribouillot_fr.ts/qm` pour la traduction française
- **Sortie de compilation** : l'exécutable est généré dans le dossier `bin/`

## Publier une version (mainteneurs)

Les binaires des trois plateformes sont construits et publiés automatiquement par le
[workflow CI](.github/workflows/build.yml) à chaque tag commençant par `v` :
```bash
git tag v2.3.0
git push origin v2.3.0
```
Le workflow compile Linux, Windows et macOS en parallèle (3 à 4 minutes), crée la release
GitHub correspondant au tag, y joint les trois fichiers et génère les notes de version à partir
des commits. Pour compiler sans publier, lancez le workflow à la main
(`gh workflow run build.yml`) : les binaires sont alors disponibles comme *artifacts* du run
pendant 90 jours.

## Dépannage

### Linux
- Si `qmake6` est introuvable, essayez `qmake` ou `qmake-qt6`
- Vérifiez que le module Qt XML est installé : `sudo apt install libqt6xml6`

### macOS
- Si `qmake` est introuvable avec Qt5, vérifiez que `qt@5` est dans votre PATH (Homebrew ne
  l'ajoute pas automatiquement)

### Windows
- Vérifiez que le dossier `bin` de Qt est dans votre PATH
- Si vous obtenez « qmake: command not found », utilisez l'invite de commandes Qt
- Pour les DLL manquantes, copiez-les depuis le dossier `bin` de Qt ou utilisez `windeployqt`
