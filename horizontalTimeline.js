/**
 * Horizontal Timeline Plugin for Squarespace
 * Transforms list sections into scroll-driven horizontal timelines
 * Copyright Will-Myers.com
 **/

class WMHorizontalTimeline {
  static pluginName = 'horizontal-timeline';

  static emitEvent(type, detail = {}, elem = document) {
    elem.dispatchEvent(new CustomEvent(`wm-${this.pluginName}${type}`, { detail, bubbles: true }));
  }

  // Frames the scroll loop keeps running after the page stops moving.
  static idleFrameLimit = 12;

  // Height change (px) below which a touch-device resize is treated as the
  // browser UI collapsing rather than a real viewport change.
  static browserChromeHeightThreshold = 200;

  constructor(el, settings = {}) {
    this.el = el;
    this.settings = {
      scrollPerItem: 300, // pixels of scroll per item
      navigationType: 'scroll', // 'scroll' or 'arrows'
      itemCards: false, // enable inverted card styling
      mobileLayout: 'horizontal', // 'horizontal' or 'vertical'
      arrowPlacement: 'bottom', // 'side', 'bottom', 'bottom-left', 'bottom-right'
      arrowPlacementMobile: 'bottom', // 'side', 'bottom', 'bottom-left', 'bottom-right'
      ...settings
    };
    this.data = null;
    this.sectionTitle = null;
    this.sectionButton = null;
    this.options = null;
    this.styles = null;
    this.originalContainer = null;
    this.pluginName = this.constructor.pluginName;
    this.isBackend = window.top !== window.self;
    this.timelineWrapper = null;
    this.progressFill = null;
    this.itemsTrack = null;
    this.dots = [];
    this.scrollHeight = 0;
    this.metrics = null;
    this.needsMeasure = true;
    this.lastProgress = null;
    this.filledCount = -1;
    this.viewportHeight = window.innerHeight;
    this.lastViewportWidth = window.innerWidth;
    this.lastScrollY = null;
    this.idleFrames = 0;
    this.rafId = null;
    this.isVisible = true;
    this.isTouch = window.matchMedia ? window.matchMedia('(hover: none)').matches : false;
    // When the browser can run the slide and fill off a scroll timeline (see the
    // @supports block in the CSS), the compositor owns them and JS only has to
    // keep the dot states in sync. Scroll mode with a horizontal layout only —
    // arrow mode animates on click and vertical mobile has its own geometry.
    this.hasScrollTimeline = typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('animation-timeline', 'view()')
      && this.settings.navigationType !== 'arrows';
    this.scrollTimelineChecked = false;
    this.boundTick = null;
    this.boundHandleScroll = null;
    this.boundHandleResize = null;
    this.boundHandleRemeasure = null;
    this.resizeObserver = null;
    this.intersectionObserver = null;
    // Arrow navigation
    this.currentIndex = 0;
    this.prevButton = null;
    this.nextButton = null;
    this.init();
  }

  init() {
    WMHorizontalTimeline.emitEvent(':beforeInit', { el: this.el }, this.el);
    this.addDataAttribute();
    this.extractData();
    this.removeOrHideOriginalListSectionContent();
    this.buildLayout();
    this.calculateDimensions();
    this.bindEvents();
    WMHorizontalTimeline.emitEvent(':afterInit', { el: this.el }, this.el);
  }

  addDataAttribute() {
    this.el.setAttribute('data-wm-plugin', this.pluginName);
    this.el.setAttribute('data-wm-navigation-type', this.settings.navigationType);
    if (this.settings.itemCards) {
      this.el.setAttribute('data-wm-item-cards', '');
    }
    if (this.settings.mobileLayout) {
      this.el.setAttribute('data-wm-mobile-layout', this.settings.mobileLayout);
    }
    if (this.settings.arrowPlacement) {
      this.el.setAttribute('data-wm-arrow-placement', this.settings.arrowPlacement);
    }
    if (this.settings.arrowPlacementMobile) {
      this.el.setAttribute('data-wm-arrow-placement-mobile', this.settings.arrowPlacementMobile);
    }
  }

  extractData() {
    const container = this.el.querySelector('.user-items-list-item-container');
    if (!container || !container.dataset.currentContext) {
      console.error(`[${this.pluginName}] No data-current-context found`);
      return;
    }

    const contextData = JSON.parse(container.dataset.currentContext);
    this.originalContainer = container;
    this.data = contextData.userItems || [];
    this.options = contextData.options || {};
    this.styles = contextData.styles || {};
    this.sectionTitle = contextData.sectionTitle || null;
    this.sectionButton = contextData.sectionButton || null;
    this.isSectionButtonEnabled = contextData.isSectionButtonEnabled || false;
  }

  removeOrHideOriginalListSectionContent() {
    if (!this.originalContainer) return;

    // Hide the entire user-items-list in the plugin view
    const userItemsList = this.el.querySelector('.user-items-list');
    if (userItemsList) {
      if (this.isBackend) {
        userItemsList.style.display = 'none';
      } else {
        userItemsList.style.display = 'none';
      }
    }
  }

  decodeHtml(html) {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
  }

  // Plain-text version of an HTML string (used for accessible names)
  getPlainText(html) {
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = this.decodeHtml(html);
    return (temp.textContent || '').replace(/\s+/g, ' ').trim();
  }

  sanitizeTitleHtml(html) {
    if (!html) return '';
    // Decode HTML entities
    const decoded = this.decodeHtml(html);
    // Create a temporary container
    const temp = document.createElement('div');
    temp.innerHTML = decoded;
    // Remove empty <p> elements
    const emptyPs = temp.querySelectorAll('p');
    emptyPs.forEach(p => {
      if (!p.textContent.trim() && !p.querySelector('img, video, iframe')) {
        p.remove();
      }
    });
    return temp.innerHTML;
  }

  buildLayout() {
    if (!this.data || this.data.length === 0) return;

    // Find the user-items-list to insert the plugin as a sibling
    const userItemsList = this.el.querySelector('.user-items-list');
    if (!userItemsList || !userItemsList.parentElement) return;

    const contentElement = userItemsList.parentElement;

    // Create the scroll spacer for sticky behavior
    const scrollSpacer = document.createElement('div');
    scrollSpacer.className = 'wm-timeline-scroll-spacer';

    // Create the sticky wrapper
    const stickyWrapper = document.createElement('div');
    stickyWrapper.className = 'wm-timeline-sticky-wrapper';

    // Create main timeline wrapper
    this.timelineWrapper = document.createElement('div');
    this.timelineWrapper.className = 'wm-timeline-content';

    // Build section title if exists
    if (this.sectionTitle) {
      const titleHtml = this.sanitizeTitleHtml(this.sectionTitle);
      if (titleHtml) {
        const titleWrapper = document.createElement('div');
        titleWrapper.className = 'wm-timeline-section-title';
        // Check if title is just a <p> element (default from Squarespace)
        // If so, convert to h2
        const temp = document.createElement('div');
        temp.innerHTML = titleHtml;
        const children = temp.children;
        if (children.length === 1 && children[0].tagName === 'P') {
          const h2 = document.createElement('h2');
          h2.innerHTML = children[0].innerHTML;
          titleWrapper.appendChild(h2);
        } else {
          titleWrapper.innerHTML = titleHtml;
        }
        this.timelineWrapper.appendChild(titleWrapper);
      }
    }

    // Timeline area wrapper (contains progress bar and items)
    // Expose as an accessible carousel region so AT can navigate the slides.
    const timelineArea = document.createElement('div');
    timelineArea.className = 'wm-timeline-area';
    timelineArea.setAttribute('role', 'group');
    timelineArea.setAttribute('aria-roledescription', 'carousel');
    timelineArea.setAttribute('aria-label', this.getPlainText(this.sectionTitle) || 'Timeline');

    // Build labels track above progress bar.
    // This is a visual-only duplicate of the per-item labels (which live inside
    // each slide for the correct reading order), so hide it from assistive tech.
    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'wm-timeline-labels-container';
    labelsContainer.setAttribute('aria-hidden', 'true');

    this.labelsTrack = document.createElement('div');
    this.labelsTrack.className = 'wm-timeline-labels-track';

    labelsContainer.appendChild(this.labelsTrack);
    timelineArea.appendChild(labelsContainer);

    // Build progress bar container (just the track, dots move with items)
    // Purely decorative scroll-progress indicator.
    const progressContainer = document.createElement('div');
    progressContainer.className = 'wm-timeline-progress-container';
    progressContainer.setAttribute('aria-hidden', 'true');

    const progressTrack = document.createElement('div');
    progressTrack.className = 'wm-timeline-progress-track';

    this.progressFill = document.createElement('div');
    this.progressFill.className = 'wm-timeline-progress-fill';

    progressTrack.appendChild(this.progressFill);
    progressContainer.appendChild(progressTrack);
    timelineArea.appendChild(progressContainer);

    // Build items track container (dots are now part of each item)
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'wm-timeline-items-container';

    this.itemsTrack = document.createElement('div');
    this.itemsTrack.className = 'wm-timeline-items-track';

    this.data.forEach((item, index) => {
      const result = this.buildTimelineItem(item, index);
      this.itemsTrack.appendChild(result.element);
      // Store reference to the dot inside the item
      const dot = result.element.querySelector('.wm-timeline-dot');
      if (dot) this.dots.push(dot);
      // Add label to labels track
      this.labelsTrack.appendChild(result.labelWrapper);
    });

    itemsContainer.appendChild(this.itemsTrack);
    timelineArea.appendChild(itemsContainer);

    // Build arrow navigation (list section style with backgrounds)
    if (this.settings.navigationType === 'arrows') {
      const arrowsWrapper = document.createElement('div');
      arrowsWrapper.className = 'wm-timeline-arrows';

      // Previous arrow
      this.prevButton = document.createElement('button');
      this.prevButton.className = 'wm-timeline-arrow wm-timeline-arrow--prev';
      this.prevButton.setAttribute('aria-label', 'Previous');
      this.prevButton.innerHTML = `<div class="wm-timeline-arrow-bg"></div>
        <svg viewBox="0 0 44 18" xmlns="http://www.w3.org/2000/svg">
          <path d="M9.90649 16.96L2.1221 9.17556L9.9065 1.39116"></path>
          <path d="M42.8633 9.18125L3.37868 9.18125"></path>
        </svg>`;

      // Next arrow
      this.nextButton = document.createElement('button');
      this.nextButton.className = 'wm-timeline-arrow wm-timeline-arrow--next';
      this.nextButton.setAttribute('aria-label', 'Next');
      this.nextButton.innerHTML = `<div class="wm-timeline-arrow-bg"></div>
        <svg viewBox="0 0 44 18" xmlns="http://www.w3.org/2000/svg">
          <path d="M34.1477 1.39111L41.9321 9.17551L34.1477 16.9599"></path>
          <path d="M1.19088 9.16982H40.6755"></path>
        </svg>`;

      arrowsWrapper.appendChild(this.prevButton);
      arrowsWrapper.appendChild(this.nextButton);
      timelineArea.appendChild(arrowsWrapper);
    }

    this.timelineWrapper.appendChild(timelineArea);

    // Build section button if enabled in list section settings
    if (this.isSectionButtonEnabled && this.sectionButton && this.sectionButton.buttonText) {
      const buttonWrapper = document.createElement('div');
      buttonWrapper.className = 'wm-timeline-section-button';
      
      const buttonLink = document.createElement('a');
      buttonLink.className = 'wm-timeline-button sqs-block-button-element sqs-button-element--primary';
      buttonLink.href = this.sectionButton.buttonLink || '#';
      buttonLink.textContent = this.sectionButton.buttonText;
      if (this.sectionButton.buttonNewWindow) {
        buttonLink.target = '_blank';
        buttonLink.rel = 'noopener noreferrer';
      }
      
      buttonWrapper.appendChild(buttonLink);
      this.timelineWrapper.appendChild(buttonWrapper);
    }

    stickyWrapper.appendChild(this.timelineWrapper);
    scrollSpacer.appendChild(stickyWrapper);
    
    // Insert as sibling to user-items-list (after it)
    userItemsList.insertAdjacentElement('afterend', scrollSpacer);
  }

  buildTimelineItem(item, index) {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'wm-timeline-item';
    itemWrapper.dataset.index = index;
    itemWrapper.setAttribute('role', 'group');
    itemWrapper.setAttribute('aria-roledescription', 'slide');

    // Extract label from title if enclosed in []
    let titleText = item.title || '';
    let labelText = '';
    const labelMatch = titleText.match(/\[([^\]]+)\]/);
    if (labelMatch) {
      labelText = labelMatch[1];
      titleText = titleText.replace(/\s*\[[^\]]+\]\s*/, ' ').trim();
    }

    // Accessible name for the slide. Lead with the label (e.g. the year) when
    // present so AT announces it as you move slide-to-slide and when reading the
    // slide, then the position. This is the only place the label is exposed to AT.
    const slidePosition = `${index + 1} of ${this.data.length}`;
    itemWrapper.setAttribute('aria-label', labelText ? `${labelText}, ${slidePosition}` : slidePosition);

    // Create label wrapper for labels track (always create for alignment)
    const labelWrapper = document.createElement('div');
    labelWrapper.className = 'wm-timeline-label-wrapper';
    labelWrapper.dataset.index = index;
    
    if (labelText) {
      const label = document.createElement('p');
      label.className = 'wm-timeline-item-label';
      label.textContent = labelText;
      labelWrapper.appendChild(label);
    }

    // Inline label for vertical mobile layout (visual only - the year is exposed
    // to assistive tech through the slide's accessible name above).
    if (labelText) {
      const inlineLabel = document.createElement('p');
      inlineLabel.className = 'wm-timeline-item-label-inline';
      inlineLabel.textContent = labelText;
      inlineLabel.setAttribute('aria-hidden', 'true');
      itemWrapper.appendChild(inlineLabel);
    }

    // Dot (moves with item) - decorative
    const dot = document.createElement('div');
    dot.className = 'wm-timeline-dot';
    dot.dataset.index = index;
    dot.setAttribute('aria-hidden', 'true');
    itemWrapper.appendChild(dot);

    // Image
    if (item.image && item.image.assetUrl && this.options.isMediaEnabled !== false) {
      const mediaWrapper = document.createElement('div');
      mediaWrapper.className = 'wm-timeline-item-media';
      
      const img = document.createElement('img');
      img.src = `${item.image.assetUrl}?format=750w`;
      img.alt = titleText || '';
      img.loading = 'lazy';
      
      const focalX = item.image.mediaFocalPoint?.x ?? 0.5;
      const focalY = item.image.mediaFocalPoint?.y ?? 0.5;
      img.style.objectPosition = `${focalX * 100}% ${focalY * 100}%`;
      
      mediaWrapper.appendChild(img);
      itemWrapper.appendChild(mediaWrapper);
    }

    // Content wrapper for text elements
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'wm-timeline-item-content';

    // Title
    if (titleText && this.options.isTitleEnabled !== false) {
      const title = document.createElement('h3');
      title.className = 'wm-timeline-item-title';
      title.textContent = titleText;
      contentWrapper.appendChild(title);
    }

    // Description
    if (item.description && this.options.isBodyEnabled !== false) {
      const description = document.createElement('div');
      description.className = 'wm-timeline-item-description';
      description.innerHTML = item.description;
      contentWrapper.appendChild(description);
    }

    // Button
    if (item.button && item.button.buttonText && this.options.isButtonEnabled !== false) {
      const buttonWrapper = document.createElement('div');
      buttonWrapper.className = 'wm-timeline-item-button-wrapper';
      
      const button = document.createElement('a');
      button.className = 'wm-timeline-item-button sqs-block-button-element sqs-button-element--secondary';
      button.href = item.button.buttonLink || '#';
      button.textContent = item.button.buttonText;
      if (item.button.buttonNewWindow) {
        button.target = '_blank';
        button.rel = 'noopener noreferrer';
      }
      
      buttonWrapper.appendChild(button);
      contentWrapper.appendChild(buttonWrapper);
    }

    itemWrapper.appendChild(contentWrapper);
    return { element: itemWrapper, labelWrapper: labelWrapper };
  }

  calculateDimensions() {
    if (!this.data || this.data.length === 0) return;

    const scrollSpacer = this.el.querySelector('.wm-timeline-scroll-spacer');
    if (!scrollSpacer) return;

    const isMobile = window.innerWidth <= 767;
    const isVerticalMobile = isMobile && this.settings.mobileLayout === 'vertical';

    // For arrow navigation or vertical mobile layout, no extra scroll height needed
    if (this.settings.navigationType === 'arrows' || isVerticalMobile) {
      scrollSpacer.style.height = 'auto';
      return;
    }

    // Get viewport height and timeline content height
    const viewportHeight = window.innerHeight;
    const stickyWrapper = this.el.querySelector('.wm-timeline-sticky-wrapper');
    const contentHeight = stickyWrapper ? stickyWrapper.offsetHeight : viewportHeight;

    // Calculate total scroll distance needed
    // We need enough scroll to move through all items
    const itemCount = this.data.length;
    const scrollPerItem = this.settings.scrollPerItem || 300;
    
    // Total scroll height = viewport (for initial stick) + scroll distance for all items + viewport (for unstick)
    this.scrollHeight = contentHeight + (itemCount * scrollPerItem);
    
    // Set the scroll spacer height
    scrollSpacer.style.height = `${this.scrollHeight}px`;
  }

  isVerticalLayout() {
    return window.innerWidth <= 767 && this.settings.mobileLayout === 'vertical';
  }

  /**
   * Collect every geometry value the scroll loop needs in one batch, then do the
   * layout-affecting writes once. Everything in here used to run per scroll
   * frame — including a getComputedStyle call and an offsetLeft read per dot —
   * which forced a synchronous layout of the pinned section many times a frame.
   */
  measure() {
    this.needsMeasure = false;
    this.metrics = null;

    const scrollSpacer = this.el.querySelector('.wm-timeline-scroll-spacer');
    const progressTrack = this.el.querySelector('.wm-timeline-progress-track');
    if (!scrollSpacer || !progressTrack || !this.itemsTrack || !this.progressFill) return;

    if (this.isVerticalLayout()) {
      const timelineArea = this.el.querySelector('.wm-timeline-area');
      if (!timelineArea) return;

      // Read phase.
      const areaHeight = timelineArea.getBoundingClientRect().height;
      const trackRect = progressTrack.getBoundingClientRect();
      const trackTop = trackRect.top;
      const trackHeight = trackRect.height;
      // Dot centres as offsets down the track, which stay fixed as the page
      // scrolls because the dots and the track move together.
      const dotCentres = this.dots.map(dot => {
        const rect = dot.getBoundingClientRect();
        return rect.top - trackTop + (rect.height / 2);
      });

      this.metrics = { vertical: true, areaHeight, trackHeight, dotCentres, timelineArea };
      return;
    }

    const itemsContainer = this.el.querySelector('.wm-timeline-items-container');
    const timelineContent = this.el.querySelector('.wm-timeline-content');
    const stickyWrapper = this.el.querySelector('.wm-timeline-sticky-wrapper');
    if (!itemsContainer) return;

    // Read phase — batch every layout read before writing anything.
    const containerWidth = itemsContainer.offsetWidth;
    const trackWidth = this.itemsTrack.scrollWidth;
    const contentPadding = timelineContent
      ? parseFloat(getComputedStyle(timelineContent).paddingLeft) || 0
      : 0;
    const contentHeight = stickyWrapper ? stickyWrapper.offsetHeight : this.viewportHeight;
    const dotCentres = this.dots.map(dot => {
      const item = dot.closest('.wm-timeline-item');
      return item ? item.offsetLeft + (item.offsetWidth / 2) : 0;
    });

    const maxTranslate = Math.max(0, trackWidth - containerWidth + contentPadding);
    const scrollRange = this.scrollHeight - contentHeight;

    // Write phase.
    progressTrack.style.width = `${trackWidth}px`;
    // Feeds the CSS scroll timeline: the slide distance, and the height of the
    // pinned content, which is what the timeline's range is inset to.
    this.el.style.setProperty('--wm-timeline-max-translate', `${maxTranslate}px`);
    this.el.style.setProperty('--wm-timeline-content-height', `${contentHeight}px`);

    this.metrics = {
      vertical: false,
      trackWidth,
      maxTranslate,
      scrollRange,
      dotCentres,
      scrollSpacer,
      progressTrack
    };
  }

  /**
   * The CSS scroll timeline is only worth deferring to if the browser actually
   * resolved it. If it reports no current time the carousel would sit frozen at
   * its start, so fall back to driving the transforms from here.
   */
  verifyScrollTimeline() {
    if (this.scrollTimelineChecked) return;
    if (!this.itemsTrack || typeof this.itemsTrack.getAnimations !== 'function') {
      this.hasScrollTimeline = false;
      this.scrollTimelineChecked = true;
      return;
    }

    const isDriven = this.itemsTrack.getAnimations().some(animation => (
      animation.timeline
      && animation.timeline !== document.timeline
      && animation.timeline.currentTime !== null
    ));

    this.scrollTimelineChecked = true;
    if (!isDriven) {
      this.hasScrollTimeline = false;
      this.lastProgress = null;
      // Switches the CSS back to the transition-based tracks this class drives.
      this.el.setAttribute('data-wm-js-driven', 'true');
    }
  }

  updateTimeline() {
    if (this.hasScrollTimeline && !this.isVerticalLayout()) this.verifyScrollTimeline();
    if (this.needsMeasure) this.measure();

    const metrics = this.metrics;
    if (!metrics) return;

    if (metrics.vertical) {
      // The only layout read in the scroll path.
      const areaTop = metrics.timelineArea.getBoundingClientRect().top;
      const threshold = this.viewportHeight * 0.3;
      const scrollRange = metrics.areaHeight - threshold;
      const progress = scrollRange > 0
        ? Math.max(0, Math.min(1, (threshold - areaTop) / scrollRange))
        : 0;

      if (progress !== this.lastProgress) {
        this.lastProgress = progress;
        this.progressFill.style.transform = `scaleY(${progress})`;
      }

      this.setFilledDots(metrics.dotCentres, progress * metrics.trackHeight);
      return;
    }

    // The only layout read in the scroll path.
    const spacerTop = metrics.scrollSpacer.getBoundingClientRect().top;
    const progress = metrics.scrollRange > 0
      ? Math.max(0, Math.min(1, -spacerTop / metrics.scrollRange))
      : 0;

    if (progress !== this.lastProgress) {
      this.lastProgress = progress;

      if (!this.hasScrollTimeline) {
        const translate = `translateX(-${progress * metrics.maxTranslate}px)`;
        this.itemsTrack.style.transform = translate;
        if (this.labelsTrack) this.labelsTrack.style.transform = translate;
        metrics.progressTrack.style.transform = translate;
        this.progressFill.style.transform = `scaleX(${progress})`;
      }
    }

    this.setFilledDots(metrics.dotCentres, progress * metrics.trackWidth);
  }

  /**
   * Dot centres ascend along the track, so the filled state is just a count.
   * Only touch the DOM when that count actually changes.
   */
  setFilledDots(centres, filledExtent) {
    let count = 0;
    while (count < centres.length && filledExtent >= centres[count]) count += 1;
    if (count === this.filledCount) return;

    this.filledCount = count;
    this.dots.forEach((dot, index) => {
      dot.classList.toggle('wm-timeline-dot--filled', index < count);
    });
  }

  /**
   * Keep a short-lived rAF loop running while the page moves. Mobile Safari
   * delivers scroll events unevenly during momentum scrolling, so updating
   * straight off the event makes a pinned carousel freeze and jump; a frame loop
   * that idles out after the scroll settles keeps it on the display refresh.
   */
  requestTick() {
    if (this.rafId !== null) return;
    this.idleFrames = 0;
    this.rafId = requestAnimationFrame(this.boundTick);
  }

  tick() {
    this.rafId = null;

    const scrollY = window.scrollY;
    if (scrollY === this.lastScrollY) {
      this.idleFrames += 1;
    } else {
      this.lastScrollY = scrollY;
      this.idleFrames = 0;
    }

    this.updateTimeline();

    if (this.isVisible && this.idleFrames < WMHorizontalTimeline.idleFrameLimit) {
      this.rafId = requestAnimationFrame(this.boundTick);
    }
  }

  // Arrow navigation methods
  goToIndex(index) {
    if (!this.data || this.data.length === 0) return;
    
    const itemCount = this.data.length;
    this.currentIndex = Math.max(0, Math.min(index, itemCount - 1));
    
    const itemsContainer = this.el.querySelector('.wm-timeline-items-container');
    const progressTrack = this.el.querySelector('.wm-timeline-progress-track');
    const timelineContent = this.el.querySelector('.wm-timeline-content');
    const items = this.itemsTrack ? this.itemsTrack.querySelectorAll('.wm-timeline-item') : [];
    
    if (itemsContainer && this.itemsTrack && items.length > 0 && progressTrack) {
      const containerWidth = itemsContainer.offsetWidth;
      const currentItem = items[this.currentIndex];
      const currentDot = this.dots[this.currentIndex];
      
      // Get the content padding to inset the end position
      const contentPadding = timelineContent 
        ? parseFloat(getComputedStyle(timelineContent).paddingLeft) || 0 
        : 0;
      
      if (currentItem && currentDot) {
        const itemOffset = currentItem.offsetLeft;
        const itemWidth = currentItem.offsetWidth;
        const targetTranslate = Math.max(0, itemOffset - (containerWidth / 2) + (itemWidth / 2));
        const trackScrollWidth = this.itemsTrack.scrollWidth;
        const maxTranslate = Math.max(0, trackScrollWidth - containerWidth + contentPadding);
        const translateX = Math.min(targetTranslate, maxTranslate);
        
        // Move items
        this.itemsTrack.style.transform = `translateX(-${translateX}px)`;
        
        // Sync labels track
        if (this.labelsTrack) {
          this.labelsTrack.style.transform = `translateX(-${translateX}px)`;
        }
        
        // Sync progress track with items (scrolls off screen)
        progressTrack.style.width = `${trackScrollWidth}px`;
        progressTrack.style.transform = `translateX(-${translateX}px)`;
        
        // Calculate progress fill to the dot position within the track
        const dotCenter = itemOffset + (itemWidth / 2);
        let fillPercent;
        if (this.currentIndex === itemCount - 1) {
          fillPercent = 100;
        } else {
          fillPercent = (dotCenter / trackScrollWidth) * 100;
        }
        
        this.progressFill.style.transform = `scaleX(${fillPercent / 100})`;
      }
    }

    // Update dots based on current index
    this.filledCount = this.currentIndex + 1;
    this.dots.forEach((dot, i) => {
      dot.classList.toggle('wm-timeline-dot--filled', i <= this.currentIndex);
    });
    
    this.updateArrowStates();
  }

  goNext() {
    if (this.currentIndex < this.data.length - 1) {
      this.goToIndex(this.currentIndex + 1);
    }
  }

  goPrev() {
    if (this.currentIndex > 0) {
      this.goToIndex(this.currentIndex - 1);
    }
  }

  updateArrowStates() {
    if (!this.prevButton || !this.nextButton) return;
    const atStart = this.currentIndex === 0;
    const atEnd = this.currentIndex >= this.data.length - 1;
    this.prevButton.classList.toggle('wm-timeline-arrow--disabled', atStart);
    this.nextButton.classList.toggle('wm-timeline-arrow--disabled', atEnd);
    // Reflect state to assistive tech while keeping the buttons focusable so
    // keyboard users can still discover the start/end of the carousel.
    this.prevButton.setAttribute('aria-disabled', atStart ? 'true' : 'false');
    this.nextButton.setAttribute('aria-disabled', atEnd ? 'true' : 'false');
  }

  // Scroll the page so that the given item is brought into view (scroll mode).
  // Used so that keyboard focus landing on an off-screen card reveals it.
  scrollToIndex(index) {
    if (!this.data || this.data.length === 0) return;

    const isMobile = window.innerWidth <= 767;
    const isVertical = isMobile && this.settings.mobileLayout === 'vertical';
    // Vertical layout is in normal document flow; the browser reveals focus itself.
    if (isVertical) return;

    const scrollSpacer = this.el.querySelector('.wm-timeline-scroll-spacer');
    const itemsContainer = this.el.querySelector('.wm-timeline-items-container');
    const stickyWrapper = this.el.querySelector('.wm-timeline-sticky-wrapper');
    const timelineContent = this.el.querySelector('.wm-timeline-content');
    if (!scrollSpacer || !itemsContainer || !this.itemsTrack) return;

    const items = this.itemsTrack.querySelectorAll('.wm-timeline-item');
    const item = items[index];
    if (!item) return;

    const containerWidth = itemsContainer.offsetWidth;
    const trackWidth = this.itemsTrack.scrollWidth;
    const contentPadding = timelineContent
      ? parseFloat(getComputedStyle(timelineContent).paddingLeft) || 0
      : 0;
    const maxTranslate = Math.max(0, trackWidth - containerWidth + contentPadding);
    if (maxTranslate === 0) return;

    // Target the same centered translate that arrow navigation uses, then map
    // that back to the page scroll position that produces it.
    const targetTranslate = Math.min(
      Math.max(0, item.offsetLeft - (containerWidth / 2) + (item.offsetWidth / 2)),
      maxTranslate
    );
    const progress = targetTranslate / maxTranslate;

    const contentHeight = stickyWrapper ? stickyWrapper.offsetHeight : window.innerHeight;
    const scrollRange = this.scrollHeight - contentHeight;
    if (scrollRange <= 0) return;

    const rect = scrollSpacer.getBoundingClientRect();
    const spacerTopAbsolute = window.scrollY + rect.top;
    const targetScrollY = spacerTopAbsolute + (progress * scrollRange);

    window.scrollTo(0, targetScrollY);
  }

  // Keyboard navigation for arrow mode (attached to the arrow controls).
  handleArrowKeydown(e) {
    if (!this.data || this.data.length === 0) return;
    const isVertical = window.innerWidth <= 767 && this.settings.mobileLayout === 'vertical';
    // Vertical mobile layout hides the arrows and scrolls natively.
    if (isVertical) return;

    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        this.goNext();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        this.goPrev();
        break;
      case 'Home':
        this.goToIndex(0);
        break;
      case 'End':
        this.goToIndex(this.data.length - 1);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  bindEvents() {
    // Reveal a card when keyboard focus enters it. Fixes focus landing on a
    // card that is translated off-screen (works in both scroll and arrow modes).
    this.boundHandleFocusIn = (e) => {
      const item = e.target.closest('.wm-timeline-item');
      if (!item || !this.itemsTrack || !this.itemsTrack.contains(item)) return;
      const index = parseInt(item.dataset.index, 10);
      if (Number.isNaN(index)) return;
      if (this.settings.navigationType === 'arrows') {
        this.goToIndex(index);
      } else {
        this.scrollToIndex(index);
      }
    };
    this.el.addEventListener('focusin', this.boundHandleFocusIn);

    // Arrow navigation mode (works on desktop and horizontal mobile)
    if (this.settings.navigationType === 'arrows') {
      this.isAnimating = false;
      const arrowDuration = 400; // matches --timeline-arrow-duration default
      
      this.prevButton?.addEventListener('click', () => {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.goPrev();
        setTimeout(() => { this.isAnimating = false; }, arrowDuration);
      });
      this.nextButton?.addEventListener('click', () => {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.goNext();
        setTimeout(() => { this.isAnimating = false; }, arrowDuration);
      });

      // Arrow keys / Home / End navigate the carousel when an arrow is focused.
      this.boundHandleKeydown = (e) => this.handleArrowKeydown(e);
      const arrowsWrapper = this.el.querySelector('.wm-timeline-arrows');
      if (arrowsWrapper) {
        arrowsWrapper.addEventListener('keydown', this.boundHandleKeydown);
      }

      requestAnimationFrame(() => this.goToIndex(0));
      
      // For arrow mode, only need resize handler (unless vertical mobile)
      let resizeTimeout;
      this.boundHandleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          const currentIsMobile = window.innerWidth <= 767;
          const currentIsVertical = currentIsMobile && this.settings.mobileLayout === 'vertical';
          
          this.calculateDimensions();
          this.needsMeasure = true;

          if (currentIsVertical) {
            this.viewportHeight = window.innerHeight;
            this.updateTimeline();
          } else {
            this.goToIndex(this.currentIndex);
          }
        }, 100);
      };
      window.addEventListener('resize', this.boundHandleResize, { passive: true });
      
      // Also need scroll handler for vertical mobile layout
      if (this.settings.mobileLayout === 'vertical') {
        this.boundTick = () => this.tick();
        this.boundHandleScroll = () => {
          if (this.isVerticalLayout()) this.requestTick();
        };
        window.addEventListener('scroll', this.boundHandleScroll, { passive: true });
      }
      return;
    }

    // Scroll navigation mode (default) - works on all layouts
    this.boundTick = () => this.tick();
    this.boundHandleScroll = () => this.requestTick();
    this.boundHandleRemeasure = () => {
      this.calculateDimensions();
      this.needsMeasure = true;
      this.requestTick();
    };

    // Debounced resize handler
    let resizeTimeout;
    this.boundHandleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const widthChanged = width !== this.lastViewportWidth;

      // Mobile Safari fires resize as the URL bar collapses and expands during a
      // scroll. Adopting that height moves the vertical layout's trigger line
      // mid-scroll and makes the progress jump, so keep the cached height for
      // small height-only changes.
      const isBrowserChrome = this.isTouch
        && !widthChanged
        && Math.abs(height - this.viewportHeight) < WMHorizontalTimeline.browserChromeHeightThreshold;

      this.lastViewportWidth = width;
      if (!isBrowserChrome) this.viewportHeight = height;

      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(this.boundHandleRemeasure, 100);
    };

    window.addEventListener('scroll', this.boundHandleScroll, { passive: true });
    window.addEventListener('resize', this.boundHandleResize, { passive: true });
    window.addEventListener('orientationchange', this.boundHandleRemeasure);
    window.addEventListener('load', this.boundHandleRemeasure);
    // Late-loading webfonts and lazy images change item widths.
    document.fonts?.ready.then(this.boundHandleRemeasure).catch(() => {});

    // Also observe for size changes
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.boundHandleRemeasure);
      const itemsTrack = this.el.querySelector('.wm-timeline-items-track');
      if (itemsTrack) {
        this.resizeObserver.observe(itemsTrack);
      }
    }

    const scrollSpacer = this.el.querySelector('.wm-timeline-scroll-spacer');
    if (typeof IntersectionObserver !== 'undefined' && scrollSpacer) {
      this.intersectionObserver = new IntersectionObserver(entries => {
        this.isVisible = entries.some(entry => entry.isIntersecting);
        if (this.isVisible) this.requestTick();
      }, { rootMargin: '20% 0px' });
      this.intersectionObserver.observe(scrollSpacer);
    }

    // Initial update
    requestAnimationFrame(() => {
      this.needsMeasure = true;
      this.updateTimeline();
    });
  }

  destroy() {
    // Remove event listeners
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.boundHandleScroll) {
      window.removeEventListener('scroll', this.boundHandleScroll);
    }
    if (this.boundHandleResize) {
      window.removeEventListener('resize', this.boundHandleResize);
    }
    if (this.boundHandleRemeasure) {
      window.removeEventListener('orientationchange', this.boundHandleRemeasure);
      window.removeEventListener('load', this.boundHandleRemeasure);
    }
    if (this.boundHandleFocusIn) {
      this.el.removeEventListener('focusin', this.boundHandleFocusIn);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    // Remove custom content
    const scrollSpacer = this.el.querySelector('.wm-timeline-scroll-spacer');
    if (scrollSpacer) {
      scrollSpacer.remove();
    }

    // Restore original list section visibility
    const userItemsList = this.el.querySelector('.user-items-list');
    if (userItemsList) {
      userItemsList.style.display = '';
    }

    // Remove data attribute
    this.el.removeAttribute('data-wm-plugin');
    this.el.removeAttribute('data-wm-js-driven');
    this.el.style.removeProperty('--wm-timeline-max-translate');
    this.el.style.removeProperty('--wm-timeline-content-height');

    // Clear references
    this.timelineWrapper = null;
    this.progressFill = null;
    this.itemsTrack = null;
    this.dots = [];
    this.metrics = null;
    this.needsMeasure = true;
    this.lastProgress = null;
    this.filledCount = -1;

    WMHorizontalTimeline.emitEvent(':destroy', { el: this.el }, this.el);
  }
}

// Immediate initialization
(function() {
  const pluginName = 'horizontal-timeline';
  const sections = document.querySelectorAll(`[id^="${pluginName}"]`);
  const instances = [];

  sections.forEach(section => {
    const sectionId = section.id;
    const settings = window.wmHorizontalTimelineSettings?.[sectionId] || {};
    const instance = new WMHorizontalTimeline(section, settings);
    instances.push(instance);
  });

  // Backend teardown when edit mode activates
  if (window.top !== window.self) {
    const observer = new MutationObserver(() => {
      if (document.body.classList.contains('sqs-edit-mode-active')) {
        instances.forEach(instance => {
          if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
          }
        });
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }
})();
