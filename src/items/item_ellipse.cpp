/**
 *  @brief     An ellipse defined by its 2 foci and the sum of distances
 *  @details   The sum of the distances from any point of the ellipse to the
 *             foci is constant and equals the major axis length.
 *  @author    Ludovic A.
 *  @date      2015 /2016/2017/2018
 *  @bug       No known bugs
 *  @copyright GNU Public License v3
 */

#include <QDebug>
#include <QPen>
#include <QtMath>

#include "item_ellipse.h"
#include "gribouillotscene.h"

Item_ellipse::Item_ellipse(QColor penColor, int penWidth, QPointF focus1,
                           QPointF focus2, qreal dSum):
    /**
     * The item reference system is centered on the ellipse center with the
     * x axis along the focal axis; the item is then positioned and rotated
     * in scene coordinates. The caller must guarantee dSum > focal distance.
     */
    QGraphicsEllipseItem(),
    focus1(focus1),
    focus2(focus2),
    dSum(dSum)
{
    QLineF focalAxis(focus1, focus2);
    qreal a = dSum/2.0;                       //semi-major axis
    qreal c = focalAxis.length()/2.0;         //semi-focal distance
    qreal b = qSqrt(a*a - c*c);               //semi-minor axis

    setRect(-a, -b, a*2, b*2);
    setPos(focalAxis.center());
    /*
     * QLineF::angle() is counter-clockwise for an upward y axis, while
     * setRotation() is clockwise in the y-down scene system, hence '-'.
     */
    setRotation(-focalAxis.angle());
    newPen(penColor, penWidth);

}


/**
 * @brief       Construct an ellipse from saved XML data
 * @details     Be sure to call with a QDomElement containing
 *              ellipse data!
 * @attention   see also serialize2xml
 */
Item_ellipse::Item_ellipse(QDomElement e) :
    Item_ellipse(QColor(e.attribute("color")),
                 e.attribute("penWidth").toInt(),
                 QPointF(e.attribute("x1").toDouble(), e.attribute("y1").toDouble()),
                 QPointF(e.attribute("x2").toDouble(), e.attribute("y2").toDouble()),
                 e.attribute("dSum").toDouble())
{}


/**
 * @brief Item_ellipse::newPen
 */
void Item_ellipse::newPen(QColor penColor, int penWidth)
{
    QPen pen(penColor, penWidth);
    pen.setCosmetic(true);//Very important to keep ellipses visible when zooming out.
    pen.setCapStyle(Qt::FlatCap);
    setPen(pen);

    selectionMargin = penWidth/2+5;
    update();
}


/**
 * @brief Item_ellipse::getSemiMajorAxis accessor
 */
qreal Item_ellipse::getSemiMajorAxis() const
{
    return rect().width()/(qreal)2;
}


/**
 * @brief Item_ellipse::getSemiMinorAxis accessor
 */
qreal Item_ellipse::getSemiMinorAxis() const
{
    return rect().height()/(qreal)2;
}


/**
 * @brief Item_ellipse::getDSum accessor
 */
qreal Item_ellipse::getDSum() const
{
    return dSum;
}


/**
 * @brief Item_ellipse::serialize2xml
 */
void Item_ellipse::serialize2xml(QXmlStreamWriter* w)
{
    w->writeStartElement("Ellipse");
    w->writeAttribute("x1", QString::number(focus1.x()));
    w->writeAttribute("y1", QString::number(focus1.y()));
    w->writeAttribute("x2", QString::number(focus2.x()));
    w->writeAttribute("y2", QString::number(focus2.y()));
    w->writeAttribute("dSum", QString::number(dSum));
    w->writeAttribute("color", pen().color().name());
    w->writeAttribute("penWidth", QString::number(pen().width()));
    w->writeEndElement();
}


/**
 * @brief   return a message to be displayed in the statusBar
 */
QString Item_ellipse::status(qreal scale, QString scaleUnit)
{
    return QObject::tr("Ellipse sum of distances to foci: ")
            +QString::number(dSum*scale, 'f', 1)+scaleUnit+"  "
            +QObject::tr("Distance between foci: ")
            +QString::number(QLineF(focus1, focus2).length()*scale, 'f', 1)+scaleUnit;

}



/***************** protected re-implemented function *******************/
QRectF Item_ellipse::boundingRect() const
{
    QPointF offset(selectionMargin, selectionMargin);
    QRectF bRect(rect().topLeft() - offset,
                rect().bottomRight() + offset);

    return bRect;
}


/**
 * @brief   A collision shape for an ellipse. In LOCAL coordinates!
 * @details Defined as an elliptical band around the outline.
 */
QPainterPath Item_ellipse::shape() const
{
    QPainterPath outline;
    outline.addEllipse(rect());

    QPainterPathStroker stroker;
    stroker.setWidth(selectionMargin*2);

    return stroker.createStroke(outline);

}


void Item_ellipse::paint(QPainter *painter, const QStyleOptionGraphicsItem *option,
                           QWidget *widget)
{
    Q_UNUSED(option);
    Q_UNUSED(widget);

    painter->setPen(pen());
    painter->drawEllipse(rect());


    if (isSelected())
    {
        QPointF offset(selectionMargin, selectionMargin);
        QRectF outRect(rect().topLeft() - offset,
                       rect().bottomRight() + offset);

        foreach(QPen selectPen, dynamic_cast<GribouillotScene*>(scene())->getSelectPens())
        {
            painter->setPen(selectPen);
            painter->drawEllipse(outRect);
        }

    }

}
