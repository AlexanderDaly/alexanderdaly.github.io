// Projects page organizer.
//
// Keeps one project panel open at a time and lets simulators pause themselves
// when they leave the active panel.

(function () {
    'use strict';

    const panels = Array.from(document.querySelectorAll('[data-project-panel]'));
    const switches = Array.from(document.querySelectorAll('[data-project-target]'));
    if (!panels.length || !switches.length) return;

    function projectFromHash() {
        const id = window.location.hash.replace(/^#/, '');
        return panels.some(panel => panel.dataset.projectPanel === id) ? id : null;
    }

    function currentProject() {
        const active = panels.find(panel => !panel.hidden);
        return active ? active.dataset.projectPanel : panels[0].dataset.projectPanel;
    }

    function notify(panel, active) {
        panel.dispatchEvent(new CustomEvent('project-panel-change', {
            bubbles: true,
            detail: {
                active,
                project: panel.dataset.projectPanel
            }
        }));
    }

    function showProject(project, options) {
        const next = panels.some(panel => panel.dataset.projectPanel === project) ?
            project :
            panels[0].dataset.projectPanel;
        const shouldScroll = options && options.scroll;

        for (const panel of panels) {
            const active = panel.dataset.projectPanel === next;
            panel.hidden = !active;
            panel.classList.toggle('is-active', active);
            panel.setAttribute('aria-hidden', active ? 'false' : 'true');
            notify(panel, active);
        }

        for (const button of switches) {
            const active = button.dataset.projectTarget === next;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
            button.tabIndex = active ? 0 : -1;
        }

        if (window.location.hash !== '#' + next) {
            window.history.replaceState(null, '', '#' + next);
        }

        if (shouldScroll) {
            const panel = panels.find(item => item.dataset.projectPanel === next);
            if (panel) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }

    for (const button of switches) {
        button.addEventListener('click', () => {
            showProject(button.dataset.projectTarget, { scroll: true });
        });

        button.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            const index = switches.indexOf(button);
            const delta = event.key === 'ArrowRight' ? 1 : -1;
            const next = switches[(index + delta + switches.length) % switches.length];
            next.focus();
            showProject(next.dataset.projectTarget, { scroll: false });
        });
    }

    window.addEventListener('hashchange', () => {
        showProject(projectFromHash() || currentProject(), { scroll: false });
    });

    showProject(projectFromHash() || currentProject(), { scroll: false });
})();
