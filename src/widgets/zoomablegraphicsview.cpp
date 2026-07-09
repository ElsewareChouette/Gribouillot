/**
 *  @brief
 *  @details
 *  @author    Ludovic A. 
 *  @date      2015 /2016/2017/2018
 *  @bug       No known bugs
 *  @copyright GNU Public License v3
 */

#include <QGraphicsItem>
#include <QDebug>
#include <QtMath>
#include <QScrollBar>
#include <QWheelEvent>

#include "zoomablegraphicsview.h"


/**
 * We must reimplement both constructors of QGraphicsView(), because those constructors
 * may be called by the UI interface.
 */
ZoomableGraphicsView::ZoomableGraphicsView(QWidget * parent) : QGraphicsView(parent)
{
    scaleBar = new ScaleBar(this);
    currentZoom = 1;

    //Black margin around the background map (see setMapRect)
    setBackgroundBrush(Qt::black);

    //see also the Designer for other UI properties of the GraphicsView.

}


ZoomableGraphicsView::~ZoomableGraphicsView()
{
    delete scaleBar;
}


qreal ZoomableGraphicsView::getZoom()
{
    return currentZoom;
}


/**
 * @brief   Limit the scrollable area to the background map plus a margin.
 * @details The margin is half a viewport wide, so the view can be scrolled
 *          until the borders of the map reach the center of the view but not
 *          further: at least one point of the map always stands at the center.
 */
void ZoomableGraphicsView::setMapRect(QRectF rect)
{
    mapRect = rect;
    updateSceneRect();
}


/**
 * @brief   Recompute the scrollable area, which depends on the size of the
 *          viewport in scene coordinates (see setMapRect).
 * @details Must be called again when the zoom or the viewport size changes.
 */
void ZoomableGraphicsView::updateSceneRect()
{
    if ( mapRect.isNull() )
        setSceneRect(QRectF());//follow the sceneRect of the scene

    else
    {
        //Half a viewport, in scene coordinates
        qreal marginW = viewport()->width()/currentZoom/2;
        qreal marginH = viewport()->height()/currentZoom/2;

        setSceneRect(mapRect.adjusted(-marginW, -marginH, marginW, marginH));
    }

}

/**
 * @brief   Zoom out (or in) so rect fits entirely in the viewport, and center on it.
 * @details Used when a background map is loaded, so it opens fully visible instead of
 *          at the zoom level (and scroll position) left over from a previous map.
 */
void ZoomableGraphicsView::zoomToFit(QRectF rect)
{
    if (rect.isEmpty() || viewport()->width() == 0 || viewport()->height() == 0)
        return;

    qreal fitZoom = qMin(viewport()->width() / rect.width(),
                          viewport()->height() / rect.height());

    qreal zoomFactor = fitZoom / currentZoom;

    resetTransform();
    scale(fitZoom, fitZoom);
    currentZoom = fitZoom;

    centerOn(rect.center());

    //The scrolling margin around the map is half a viewport wide
    updateSceneRect();

    scaleBar->zoomChanged(zoomFactor, currentZoom);
}


/********************* SLOTS *********************/
/**
 * @brief   notify the red&white scaleBar of a scale change
 */
void ZoomableGraphicsView::systemScaleChanged(qreal systemScale, QString unit)
{
    scaleBar->scaleChanged(systemScale, unit, currentZoom);
}


/**
 * @brief   center the View according to Minimap double-click
 */
void ZoomableGraphicsView::slotCenterOn(QPointF position)
{
    centerOn(position);
}

/********************* Protected *********************/

void ZoomableGraphicsView::resizeEvent(QResizeEvent *e)
{
    /**
     * Move the scaleBar so:
     * - it doesn't disappear if the containing widget of the graphicsView is reduced.
     * - it doesn't appear in the middle of the view, but still in the lower left corner,
     *   if the original application window is made bigger for example.
     */
    scaleBar->move(25, height()-45);

    QGraphicsView::resizeEvent(e);

    //The scrolling margin around the map is half a viewport wide
    updateSceneRect();
}


/**
 * @brief   Pan the view while the middle mouse button is hold down, like in
 *          "Cursor Drag" mode but whatever the current tool.
 */
void ZoomableGraphicsView::mousePressEvent(QMouseEvent *e)
{
    if (e->button() == Qt::MiddleButton)
    {
        midButtonPanning = true;
        lastPanPoint = e->pos();

        //Show a closed hand during the panning, restore the cursor afterwards
        viewportHadCursor = viewport()->testAttribute(Qt::WA_SetCursor);
        savedViewportCursor = viewport()->cursor();
        viewport()->setCursor(Qt::ClosedHandCursor);

        e->accept();
        return;//don't forward to scene, no item must react to this click
    }

    QGraphicsView::mousePressEvent(e);
}


void ZoomableGraphicsView::mouseMoveEvent(QMouseEvent *e)
{
    if (midButtonPanning)
    {
        QPoint delta = e->pos() - lastPanPoint;
        lastPanPoint = e->pos();

        //Scrolling is naturally limited by the sceneRect (see setMapRect)
        horizontalScrollBar()->setValue(horizontalScrollBar()->value() - delta.x());
        verticalScrollBar()->setValue(verticalScrollBar()->value() - delta.y());

        e->accept();
        return;
    }

    QGraphicsView::mouseMoveEvent(e);
}


void ZoomableGraphicsView::mouseReleaseEvent(QMouseEvent *e)
{
    if (e->button() == Qt::MiddleButton && midButtonPanning)
    {
        midButtonPanning = false;

        if (viewportHadCursor)
            viewport()->setCursor(savedViewportCursor);
        else
            viewport()->unsetCursor();

        e->accept();
        return;
    }

    QGraphicsView::mouseReleaseEvent(e);
}


/**
 * @brief   A quick second middle-click arrives as a double-click event; treat
 *          it as a new panning start instead of forwarding it to the scene.
 */
void ZoomableGraphicsView::mouseDoubleClickEvent(QMouseEvent *e)
{
    if (e->button() == Qt::MiddleButton)
    {
        mousePressEvent(e);
        return;
    }

    QGraphicsView::mouseDoubleClickEvent(e);
}


/**
 * @brief   Handles mouse wheel events concerning the graphicsView.
 * @details Implements zooming in or out upon rolling the mouse wheel.
 *          Also changes the zoom level of the red & white scalebar.
 */
#ifndef QT_NO_WHEELEVENT
void ZoomableGraphicsView::wheelEvent(QWheelEvent *e)
{
    /**
     * Warning: Combining numerous successive zoom In and Out can yield to
     * side-effects due to the floating point operations involved, particularly
     * for the scaleBar. To prevent this zoomOut has high floating precision.
     */
    double zoomFactor;
    if (e->angleDelta().y() < 0)
        zoomFactor = zoomOutFactor;
    else
        zoomFactor = zoomInFactor;

    scale(zoomFactor, zoomFactor);
    currentZoom*=zoomFactor;//qDebug() << "zoom: " << currentZoom;

    //The scrolling margin around the map is half a viewport wide
    updateSceneRect();

    //Tell scalebar of the zoom change.
    scaleBar->zoomChanged(zoomFactor, currentZoom);

    e->accept();

}
#endif



