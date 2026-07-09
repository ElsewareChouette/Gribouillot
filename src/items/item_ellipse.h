/**
 *  @brief     An ellipse defined by its 2 foci and the sum of distances
 *  @details   The sum of the distances from any point of the ellipse to the
 *             foci is constant and equals the major axis length.
 *  @author    Ludovic A.
 *  @date      2015 /2016/2017/2018
 *  @bug       No known bugs
 *  @copyright GNU Public License v3
 */

#ifndef ITEM_ELLIPSE_H
#define ITEM_ELLIPSE_H

#include <QDomDocument>
#include <QGraphicsEllipseItem>
#include <QPainter>
#include <QKeyEvent>
#include <QXmlStreamWriter>

#include "gribouillotitem.h"

class Item_ellipse : public QGraphicsEllipseItem
{
public:
    enum { Type = ELLIPSE };
    int type() const
    {
        // Enable the use of qgraphicsitem_cast with this item.
        return ELLIPSE;
    }
    explicit Item_ellipse(QColor penColor, int penWidth, QPointF focus1,
                          QPointF focus2, qreal dSum);
    explicit Item_ellipse(QDomElement e);
    ~Item_ellipse(){}

    void newPen(QColor penColor, int penWidth);
    qreal getSemiMajorAxis() const;
    qreal getSemiMinorAxis() const;
    qreal getDSum() const;
    void serialize2xml(QXmlStreamWriter* w);
    QString status(qreal scale, QString scaleUnit);

protected:
    QRectF boundingRect() const Q_DECL_OVERRIDE;
    QPainterPath shape() const Q_DECL_OVERRIDE;
    void paint (QPainter* painter, const QStyleOptionGraphicsItem* option,
             QWidget* widget = 0) Q_DECL_OVERRIDE;

private:
    QPointF focus1, focus2;//in scene coordinates
    qreal dSum;
    int selectionMargin;

};

#endif // ITEM_ELLIPSE_H
