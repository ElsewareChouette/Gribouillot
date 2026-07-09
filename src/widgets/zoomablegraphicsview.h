/**
 *  @brief
 *  @details
 *  @author    Ludovic A. 
 *  @date      2015 /2016/2017/2018
 *  @bug       No known bugs
 *  @copyright GNU Public License v3
 */

#ifndef ZOOMABLEGRAPHICSVIEW_H
#define ZOOMABLEGRAPHICSVIEW_H

#include <QFrame>
#include <QGraphicsView>
#include <QEvent>

#include "scalebar.h"

/**
 * @brief Subclass QGraphicsView to implement wheelEvent
 */
class ZoomableGraphicsView : public QGraphicsView
{
    Q_OBJECT
public:
    explicit ZoomableGraphicsView(QWidget *parent = 0);
    ~ZoomableGraphicsView();

    qreal getZoom();
    void setMapRect(QRectF rect);

public slots:
    void systemScaleChanged(qreal systemScale, QString unit);
    void slotCenterOn(QPointF position);

protected:
    void resizeEvent(QResizeEvent *e) Q_DECL_OVERRIDE;
    void mousePressEvent(QMouseEvent *e) Q_DECL_OVERRIDE;
    void mouseMoveEvent(QMouseEvent *e) Q_DECL_OVERRIDE;
    void mouseReleaseEvent(QMouseEvent *e) Q_DECL_OVERRIDE;
    void mouseDoubleClickEvent(QMouseEvent *e) Q_DECL_OVERRIDE;
#ifndef QT_NO_WHEELEVENT
    void wheelEvent(QWheelEvent *e) Q_DECL_OVERRIDE;
#endif

private:
    ScaleBar *scaleBar;
    qreal currentZoom;
    QRectF mapRect;

    //Panning with the middle mouse button hold down
    bool midButtonPanning = false;
    QPoint lastPanPoint;
    QCursor savedViewportCursor;
    bool viewportHadCursor = false;

    void updateSceneRect();

    const double zoomOutFactor = 0.83333333;
    const double zoomInFactor = 1.2;

};

#endif // ZOOMABLEGRAPHICSVIEW_H
