#target aftereffects
(function () {
    var report = File.saveDialog('保存 AE 检查报告（TXT）');
    if (!report) return;
    report.encoding = 'UTF-8';
    if (!report.open('w')) {
        alert('无法写入报告：' + report.error);
        return;
    }
    var errors = [];
    function scan(group, path, listProperties) {
        for (var i = 1; i <= group.numProperties; i++) {
            var property = group.property(i);
            var location = path + ' / ' + property.name;
            if (listProperties) {
                report.writeln(location + ' | index=' + i + ' | matchName=' + property.matchName);
            }
            if (property.propertyType === PropertyType.PROPERTY) {
                if (listProperties && property.propertyValueType === PropertyValueType.OneD) {
                    report.writeln('  value=' + property.value);
                }
                if (!listProperties && property.canSetExpression && property.expressionEnabled && property.expressionError) {
                    errors.push(location + ': ' + property.expressionError);
                }
            } else {
                scan(property, location, listProperties);
            }
        }
    }
    try {
        report.writeln('PROJECT ' + (app.project.file ? app.project.file.fsName : '(unsaved)'));
        report.writeln('AE_VERSION ' + app.version);
        var compCount = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var comp = app.project.item(i);
            if (!(comp instanceof CompItem)) continue;
            compCount++;
            report.writeln('COMP ' + comp.id + ' ' + comp.name + ' ' + comp.width + 'x' + comp.height +
                ' fps=' + comp.frameRate + ' duration=' + comp.duration + ' layers=' + comp.numLayers);
            report.writeln('RENDERER ' + comp.renderer + ' | AVAILABLE ' + comp.renderers.join(', '));
            for (var j = 1; j <= comp.numLayers; j++) scan(comp.layer(j), comp.name + ' / ' + comp.layer(j).name, false);
        }
        report.writeln('COMPOSITION_COUNT ' + compCount);
        report.writeln('EXPRESSION_ERRORS_IN_PROJECT ' + errors.length);
        for (var e = 0; e < errors.length; e++) report.writeln(errors[e]);

        var active = app.project.activeItem;
        report.writeln('SELECTED_LAYER_EFFECTS');
        if (active instanceof CompItem) {
            var selected = active.selectedLayers;
            report.writeln('ACTIVE_COMP ' + active.name + ' | SELECTED_LAYERS ' + selected.length);
            for (var k = 0; k < selected.length; k++) {
                var effects = selected[k].property('ADBE Effect Parade');
                if (effects) scan(effects, active.name + ' / ' + selected[k].name, true);
            }
        } else {
            report.writeln('(no active composition)');
        }

        report.writeln('RENDER_QUEUE ' + app.project.renderQueue.numItems);
        for (var q = 1; q <= app.project.renderQueue.numItems; q++) {
            var item = app.project.renderQueue.item(q);
            report.writeln('ITEM ' + q + ' ' + item.comp.name + ' status=' + item.status +
                ' done=' + (item.status === RQItemStatus.DONE) + ' render=' + item.render +
                ' start=' + item.timeSpanStart + ' duration=' + item.timeSpanDuration);
            for (var m = 1; m <= item.numOutputModules; m++) {
                var module = item.outputModule(m);
                report.writeln('OUTPUT ' + (module.file ? module.file.fsName : '(unset)'));
                report.writeln('OUTPUT_TEMPLATES ' + module.templates.join(' | '));
            }
        }
        report.writeln('REPORT_COMPLETE');
    } catch (error) {
        report.writeln('REPORT_ERROR ' + error.toString() + ' line=' + error.line);
        alert('检查未完成：' + error.toString());
    } finally {
        report.close();
    }
})();
