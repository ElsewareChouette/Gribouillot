QT += core gui widgets xml

TARGET = gribouillot
TEMPLATE = app

VERSION = 2.2.0
DEFINES += APP_VERSION=\\\"$$VERSION\\\"

CONFIG += c++11

# Définir le répertoire de sortie
DESTDIR = bin

# Garder les fichiers générés par Qt (moc/uic/rcc) et les objets hors des sources
MOC_DIR = build
UI_DIR = build
RCC_DIR = build
OBJECTS_DIR = build

# Permet aux #include "xxx.h" de rester "bare" malgré l'éclatement en sous-dossiers
INCLUDEPATH += \
    src/app \
    src/dialogs \
    src/items \
    src/widgets \
    src/util

# Sources
SOURCES += \
    src/app/main.cpp \
    src/app/gribouillot.cpp \
    src/app/gribouillot_toolbar.cpp \
    src/app/gribouillotlayer.cpp \
    src/app/gribouillotscene.cpp \
    src/app/gribouillottabwidget.cpp \
    src/dialogs/dlg_arcangle.cpp \
    src/dialogs/dlg_autosave.cpp \
    src/dialogs/dlg_centerofmass.cpp \
    src/dialogs/dlg_changelayername.cpp \
    src/dialogs/dlg_changemap.cpp \
    src/dialogs/dlg_circleradius.cpp \
    src/dialogs/dlg_ellipsesum.cpp \
    src/dialogs/dlg_importlayer.cpp \
    src/dialogs/dlg_newgribproject.cpp \
    src/dialogs/dlg_penthickness.cpp \
    src/dialogs/dlg_pointweight.cpp \
    src/dialogs/dlg_setupgps.cpp \
    src/dialogs/dlg_spiral.cpp \
    src/items/item_arc.cpp \
    src/items/item_arcdrawer.cpp \
    src/items/item_circle.cpp \
    src/items/item_ellipse.cpp \
    src/items/item_line.cpp \
    src/items/item_pixmap.cpp \
    src/items/item_point.cpp \
    src/items/item_pointonrail.cpp \
    src/items/item_scaleruler.cpp \
    src/items/item_segment.cpp \
    src/items/item_spiral.cpp \
    src/items/item_spiraldrawer.cpp \
    src/widgets/maptabwidget.cpp \
    src/widgets/minimap.cpp \
    src/util/qlinef58.cpp \
    src/widgets/scalebar.cpp \
    src/widgets/smartinserttabwidget.cpp \
    src/widgets/zoomablegraphicsview.cpp

# Headers
HEADERS += \
    src/app/main.h \
    src/app/gribouillot.h \
    src/app/gribouillotitem.h \
    src/app/gribouillotlayer.h \
    src/app/gribouillotscene.h \
    src/app/gribouillottabwidget.h \
    src/dialogs/dlg_arcangle.h \
    src/dialogs/dlg_autosave.h \
    src/dialogs/dlg_centerofmass.h \
    src/dialogs/dlg_changelayername.h \
    src/dialogs/dlg_changemap.h \
    src/dialogs/dlg_circleradius.h \
    src/dialogs/dlg_ellipsesum.h \
    src/dialogs/dlg_importlayer.h \
    src/dialogs/dlg_newgribproject.h \
    src/dialogs/dlg_penthickness.h \
    src/dialogs/dlg_pointweight.h \
    src/dialogs/dlg_setupgps.h \
    src/dialogs/dlg_spiral.h \
    src/items/item_arc.h \
    src/items/item_arcdrawer.h \
    src/items/item_circle.h \
    src/items/item_ellipse.h \
    src/items/item_line.h \
    src/items/item_pixmap.h \
    src/items/item_point.h \
    src/items/item_pointonrail.h \
    src/items/item_scaleruler.h \
    src/items/item_segment.h \
    src/items/item_spiral.h \
    src/items/item_spiraldrawer.h \
    src/widgets/maptabwidget.h \
    src/widgets/minimap.h \
    src/util/qlinef58.h \
    src/widgets/scalebar.h \
    src/widgets/smartinserttabwidget.h \
    src/widgets/zoomablegraphicsview.h

# Forms
FORMS += \
    src/app/gribouillot.ui \
    src/app/gribouillotlayer.ui \
    src/dialogs/dlg_arcangle.ui \
    src/dialogs/dlg_autosave.ui \
    src/dialogs/dlg_centerofmass.ui \
    src/dialogs/dlg_changelayername.ui \
    src/dialogs/dlg_changemap.ui \
    src/dialogs/dlg_circleradius.ui \
    src/dialogs/dlg_ellipsesum.ui \
    src/dialogs/dlg_importlayer.ui \
    src/dialogs/dlg_newgribproject.ui \
    src/dialogs/dlg_penthickness.ui \
    src/dialogs/dlg_pointweight.ui \
    src/dialogs/dlg_setupgps.ui \
    src/dialogs/dlg_spiral.ui \
    src/widgets/maptabwidget.ui

# Resources
RESOURCES += resources/gribouillot.qrc

# Translations
TRANSLATIONS += resources/gribouillot_fr.ts
