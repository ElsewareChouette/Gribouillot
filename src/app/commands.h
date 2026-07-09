#ifndef COMMANDS_H
#define COMMANDS_H

#include <QColor>
#include <QGraphicsItem>
#include <QList>
#include <QUndoCommand>

class GribouillotLayer;

class AddItemCommand : public QUndoCommand
{
public:
    AddItemCommand(GribouillotLayer *layer, QGraphicsItem *item, QUndoCommand *parent = nullptr);
    ~AddItemCommand() override;

    void undo() override;
    void redo() override;

private:
    GribouillotLayer *layer;
    QGraphicsItem *item;
    bool firstRedo = true;
    bool attached = true;
};

class DeleteItemsCommand : public QUndoCommand
{
public:
    DeleteItemsCommand(GribouillotLayer *layer, const QList<QGraphicsItem *> &items, QUndoCommand *parent = nullptr);
    ~DeleteItemsCommand() override;

    void undo() override;
    void redo() override;

private:
    GribouillotLayer *layer;
    QList<QGraphicsItem *> items;
    QList<int> indices;
    bool detached = false;
};

struct ItemStyle
{
    QColor color;
    int width;
};

//Read/write an item's (color, width) regardless of its concrete type (pen or brush).
ItemStyle styleOf(QGraphicsItem *item);
void applyStyle(QGraphicsItem *item, const ItemStyle &style);

class ChangeStyleCommand : public QUndoCommand
{
public:
    ChangeStyleCommand(const QList<QGraphicsItem *> &items, const QList<ItemStyle> &newStyles,
                        QUndoCommand *parent = nullptr);

    void undo() override;
    void redo() override;

private:
    QList<QGraphicsItem *> items;
    QList<ItemStyle> oldStyles;
    QList<ItemStyle> newStyles;
};

#endif // COMMANDS_H
