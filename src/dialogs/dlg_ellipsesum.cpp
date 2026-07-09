/**
 *  @brief
 *  @details
 *  @author    Ludovic A.
 *  @date      2015 /2016/2017/2018
 *  @bug       No known bugs
 *  @copyright GNU Public License v3
 */

#include "dlg_ellipsesum.h"
#include "ui_dlg_ellipsesum.h"

Dlg_ellipseSum::Dlg_ellipseSum(QWidget *parent, QString scaleUnit) :
    QDialog(parent),
    ui(new Ui::Dlg_ellipseSum)
{
    ui->setupUi(this);
    ui->dSpinBox->setSuffix(scaleUnit);
}

Dlg_ellipseSum::~Dlg_ellipseSum()
{
    delete ui;
}

qreal Dlg_ellipseSum::getSumValue()
{
    return ui->dSpinBox->value();
}
