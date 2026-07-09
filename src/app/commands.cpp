#include "commands.h"
#include "gribouillotitem.h"
#include "gribouillotlayer.h"
#include "item_arc.h"
#include "item_circle.h"
#include "item_ellipse.h"
#include "item_point.h"
#include "item_segment.h"
#include "item_spiral.h"

AddItemCommand::AddItemCommand(GribouillotLayer *layer, QGraphicsItem *item, QUndoCommand *parent)
    : QUndoCommand(parent), layer(layer), item(item)
{
    setText(QObject::tr("Add item"));
}

AddItemCommand::~AddItemCommand()
{
    if (!attached)
        delete item;
}

void AddItemCommand::undo()
{
    layer->detachItem(item);
    attached = false;
}

void AddItemCommand::redo()
{
    if (firstRedo)
    {
        firstRedo = false;
        return;
    }

    layer->attachItem(item);
    attached = true;
}

DeleteItemsCommand::DeleteItemsCommand(GribouillotLayer *layer, const QList<QGraphicsItem *> &items, QUndoCommand *parent)
    : QUndoCommand(parent), layer(layer), items(items)
{
    setText(QObject::tr("Delete %1 item(s)").arg(items.count()));

    // 'items' must be in itemsList order (as returned by GribouillotLayer::selectedItems())
    // so that undo() can re-insert them at their original indices in ascending order.
    for (QGraphicsItem *item : items)
        indices.append(layer->indexOfItem(item));
}

DeleteItemsCommand::~DeleteItemsCommand()
{
    if (detached)
        qDeleteAll(items);
}

void DeleteItemsCommand::undo()
{
    for (int i = 0; i < items.size(); ++i)
        layer->attachItem(items[i], indices[i]);
    detached = false;
}

void DeleteItemsCommand::redo()
{
    for (QGraphicsItem *item : items)
        layer->detachItem(item);
    detached = true;
}

ItemStyle styleOf(QGraphicsItem *item)
{
    switch (item->type())
    {
    case POINT_W:
    {
        Item_point *p = qgraphicsitem_cast<Item_point*>(item);
        return {p->brush().color(), (int)p->rect().width()};
    }
    case LINE:
    case SEGMENT:
    {
        Item_segment *s = dynamic_cast<Item_segment*>(item);
        return {s->pen().color(), s->pen().width()};
    }
    case CIRCLE:
    {
        Item_circle *c = qgraphicsitem_cast<Item_circle*>(item);
        return {c->pen().color(), c->pen().width()};
    }
    case ELLIPSE:
    {
        Item_ellipse *e = qgraphicsitem_cast<Item_ellipse*>(item);
        return {e->pen().color(), e->pen().width()};
    }
    case ARC:
    {
        Item_arc *a = qgraphicsitem_cast<Item_arc*>(item);
        return {a->pen().color(), a->pen().width()};
    }
    case SPIRAL:
    {
        Item_spiral *s = qgraphicsitem_cast<Item_spiral*>(item);
        return {s->pen().color(), s->pen().width()};
    }
    default:
        return {QColor(), 0};
    }
}

void applyStyle(QGraphicsItem *item, const ItemStyle &style)
{
    switch (item->type())
    {
    case POINT_W:
        qgraphicsitem_cast<Item_point*>(item)->newBrush(style.color, style.width);
        break;
    case LINE:
    case SEGMENT:
        dynamic_cast<Item_segment*>(item)->newPen(style.color, style.width);
        break;
    case CIRCLE:
        qgraphicsitem_cast<Item_circle*>(item)->newPen(style.color, style.width);
        break;
    case ELLIPSE:
        qgraphicsitem_cast<Item_ellipse*>(item)->newPen(style.color, style.width);
        break;
    case ARC:
        qgraphicsitem_cast<Item_arc*>(item)->newPen(style.color, style.width);
        break;
    case SPIRAL:
        qgraphicsitem_cast<Item_spiral*>(item)->newPen(style.color, style.width);
        break;
    default:
        break;
    }
}

ChangeStyleCommand::ChangeStyleCommand(const QList<QGraphicsItem *> &items, const QList<ItemStyle> &newStyles,
                                        QUndoCommand *parent)
    : QUndoCommand(parent), items(items), newStyles(newStyles)
{
    setText(QObject::tr("Change style"));

    for (QGraphicsItem *item : items)
        oldStyles.append(styleOf(item));
}

void ChangeStyleCommand::undo()
{
    for (int i = 0; i < items.size(); ++i)
        applyStyle(items[i], oldStyles[i]);
}

void ChangeStyleCommand::redo()
{
    for (int i = 0; i < items.size(); ++i)
        applyStyle(items[i], newStyles[i]);
}
