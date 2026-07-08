/**
 *  @brief
 *  @details
 *  @author    Ludovic A.
 *  @date      2015 /2016/2017/2018
 *  @bug       No known bugs
 *  @copyright GNU Public License v3
 */

#ifndef DLG_ELLIPSESUM_H
#define DLG_ELLIPSESUM_H

#include <QDialog>

namespace Ui {
class Dlg_ellipseSum;
}

class Dlg_ellipseSum : public QDialog
{
    Q_OBJECT

public:
    explicit Dlg_ellipseSum(QWidget *parent, QString scaleUnit);
    ~Dlg_ellipseSum();

    qreal getSumValue();

private:
    Ui::Dlg_ellipseSum *ui;
};

#endif // DLG_ELLIPSESUM_H
