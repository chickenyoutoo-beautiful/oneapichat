"""Slide transitions — inject XML into pptx slides"""
from lxml import etree

TRANSITIONS = {
    'cover':    ('fade',      500),
    'toc':      ('push',      350),
    'divider':  ('zoom',      250),
    'content':  ('fade',      300),
    'timeline': ('push',      400),
    'end':      ('fade',      600),
}

_NS = {
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
}

def apply_transition(slide, page_type):
    """One-line call to set per-slide transition animation."""
    if page_type not in TRANSITIONS:
        return
    trans_type, duration = TRANSITIONS[page_type]

    # Build transition XML
    trans_el = etree.SubElement(slide.element, f'{{{_NS["p"]}}}transition')
    trans_el.set('advTm', str(duration))

    if trans_type == 'fade':
        fade = etree.SubElement(trans_el, f'{{{_NS["p"]}}}fade')
    elif trans_type == 'push':
        push = etree.SubElement(trans_el, f'{{{_NS["p"]}}}push')
        push.set('dir', 'l')
    elif trans_type == 'zoom':
        zoom = etree.SubElement(trans_el, f'{{{_NS["p"]}}}zoom')
    # duration in ms
    dur_el = etree.SubElement(trans_el, f'{{{_NS["p"]}}}dur')
    dur_el.text = str(duration)
