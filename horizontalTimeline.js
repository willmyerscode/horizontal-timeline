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

  constructor(el, settings = {}) {
    this.el = el;
    this.settings = {
      scrollPerItem: 300, // pixels of scroll per item
      navigationType: 'scroll', // 'scroll' or 'arrows'
      itemCards: false, // enable inverted card styling
      mobileLayout: 'horizontal', // 'horizontal' or 'vertical'
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
    this.boundHandleScroll = null;
    this.boundHandleResize = null;
    this.resizeObserver = null;
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

    const contentWrapper = this.el.querySelector('.content-wrapper');
    if (!contentWrapper) return;

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
    const timelineArea = document.createElement('div');
    timelineArea.className = 'wm-timeline-area';

    // Build labels track above progress bar
    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'wm-timeline-labels-container';
    
    this.labelsTrack = document.createElement('div');
    this.labelsTrack.className = 'wm-timeline-labels-track';
    
    labelsContainer.appendChild(this.labelsTrack);
    timelineArea.appendChild(labelsContainer);

    // Build progress bar container (just the track, dots move with items)
    const progressContainer = document.createElement('div');
    progressContainer.className = 'wm-timeline-progress-container';

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
    contentWrapper.appendChild(scrollSpacer);
  }

  buildTimelineItem(item, index) {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'wm-timeline-item';
    itemWrapper.dataset.index = index;

    // Extract label from title if enclosed in []
    let titleText = item.title || '';
    let labelText = '';
    const labelMatch = titleText.match(/\[([^\]]+)\]/);
    if (labelMatch) {
      labelText = labelMatch[1];
      titleText = titleText.replace(/\s*\[[^\]]+\]\s*/, ' ').trim();
    }

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

    // Inline label for vertical mobile layout
    if (labelText) {
      const inlineLabel = document.createElement('p');
      inlineLabel.className = 'wm-timeline-item-label-inline';
      inlineLabel.textContent = labelText;
      itemWrapper.appendChild(inlineLabel);
    }

    // Dot (moves with item)
    const dot = document.createElement('div');
    dot.className = 'wm-timeline-dot';
    dot.dataset.index = index;
    itemWrapper.appendChild(dot);

    // Image
    if (item.image && item.image.assetUrl && this.options.isMediaEnabled !== false) {
      const mediaWrapper = document.createElement('div');
      mediaWrapper.className = 'wm-timeline-item-media';
      
      const img = document.createElement('img');
      img.src = `${item.image.assetUrl}?format=750w`;
      img.alt = item.title || '';
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

  updateTimeline() {
    const scrollSpacer = this.el.querySelector('.wm-timeline-scroll-spacer');
    if (!scrollSpacer || !this.itemsTrack || !this.progressFill) return;

    const isMobile = window.innerWidth <= 767;
    const isVertical = isMobile && this.settings.mobileLayout === 'vertical';

    if (isVertical) {
      const timelineArea = this.el.querySelector('.wm-timeline-area');
      if (!timelineArea) return;
      
      const areaRect = timelineArea.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const threshold = viewportHeight * 0.3;
      
      const scrollStart = threshold - areaRect.top;
      const scrollRange = areaRect.height - threshold;
      
      let progress = Math.max(0, Math.min(1, scrollStart / scrollRange));

      this.progressFill.style.height = `${progress * 100}%`;
      this.progressFill.style.width = '100%';

      const progressTrack = this.el.querySelector('.wm-timeline-progress-track');
      if (progressTrack) {
        const trackRect = progressTrack.getBoundingClientRect();
        const progressFillBottom = trackRect.top + (progress * trackRect.height);

        this.dots.forEach((dot) => {
          const dotRect = dot.getBoundingClientRect();
          const dotCenter = dotRect.top + (dotRect.height / 2);
          
          if (progressFillBottom >= dotCenter) {
            dot.classList.add('wm-timeline-dot--filled');
          } else {
            dot.classList.remove('wm-timeline-dot--filled');
          }
        });
      }
    } else {
      const rect = scrollSpacer.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const stickyWrapper = this.el.querySelector('.wm-timeline-sticky-wrapper');
      const contentHeight = stickyWrapper ? stickyWrapper.offsetHeight : viewportHeight;

      const scrollStart = -rect.top;
      const scrollRange = this.scrollHeight - contentHeight;

      let progress = Math.max(0, Math.min(1, scrollStart / scrollRange));

      this.progressFill.style.width = `${progress * 100}%`;
      this.progressFill.style.height = '100%';

      const itemsContainer = this.el.querySelector('.wm-timeline-items-container');
      if (itemsContainer && this.itemsTrack) {
        const containerWidth = itemsContainer.offsetWidth;
        const trackWidth = this.itemsTrack.scrollWidth;
        const maxTranslate = Math.max(0, trackWidth - containerWidth);
        const translateX = progress * maxTranslate;
        this.itemsTrack.style.transform = `translateX(-${translateX}px)`;
        
        if (this.labelsTrack) {
          this.labelsTrack.style.transform = `translateX(-${translateX}px)`;
        }
      }

      const progressContainer = this.el.querySelector('.wm-timeline-progress-container');
      const progressRect = progressContainer ? progressContainer.getBoundingClientRect() : null;
      
      if (progressRect) {
        const progressBarLeft = progressRect.left;
        const progressFillWidth = progress * progressRect.width;
        const progressFillRight = progressBarLeft + progressFillWidth;

        this.dots.forEach((dot) => {
          const dotRect = dot.getBoundingClientRect();
          const dotCenter = dotRect.left + (dotRect.width / 2);
          
          if (progressFillRight >= dotCenter) {
            dot.classList.add('wm-timeline-dot--filled');
          } else {
            dot.classList.remove('wm-timeline-dot--filled');
          }
        });
      }
    }
  }

  // Arrow navigation methods
  goToIndex(index) {
    if (!this.data || this.data.length === 0) return;
    
    const itemCount = this.data.length;
    this.currentIndex = Math.max(0, Math.min(index, itemCount - 1));
    
    const itemsContainer = this.el.querySelector('.wm-timeline-items-container');
    const progressTrack = this.el.querySelector('.wm-timeline-progress-track');
    const items = this.itemsTrack ? this.itemsTrack.querySelectorAll('.wm-timeline-item') : [];
    
    if (itemsContainer && this.itemsTrack && items.length > 0 && progressTrack) {
      const containerWidth = itemsContainer.offsetWidth;
      const currentItem = items[this.currentIndex];
      const currentDot = this.dots[this.currentIndex];
      
      if (currentItem && currentDot) {
        const itemOffset = currentItem.offsetLeft;
        const itemWidth = currentItem.offsetWidth;
        const targetTranslate = Math.max(0, itemOffset - (containerWidth / 2) + (itemWidth / 2));
        const trackScrollWidth = this.itemsTrack.scrollWidth;
        const maxTranslate = Math.max(0, trackScrollWidth - containerWidth);
        const translateX = Math.min(targetTranslate, maxTranslate);
        
        // Move items
        this.itemsTrack.style.transform = `translateX(-${translateX}px)`;
        
        // Sync labels track
        if (this.labelsTrack) {
          this.labelsTrack.style.transform = `translateX(-${translateX}px)`;
        }
        
        // Calculate progress fill to the dot position
        const itemCenter = itemOffset + (itemWidth / 2);
        const dotPositionAfterTranslate = itemCenter - translateX;
        const progressTrackWidth = progressTrack.offsetWidth;
        let fillPercent = Math.min(100, Math.max(0, (dotPositionAfterTranslate / progressTrackWidth) * 100));
        
        // Fill to end on last item
        if (this.currentIndex === itemCount - 1) {
          fillPercent = 100;
        }
        
        this.progressFill.style.width = `${fillPercent}%`;
      }
    }
    
    // Update dots
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
    this.prevButton.classList.toggle('wm-timeline-arrow--disabled', this.currentIndex === 0);
    this.nextButton.classList.toggle('wm-timeline-arrow--disabled', this.currentIndex >= this.data.length - 1);
  }

  bindEvents() {
    // Arrow navigation mode (works on desktop and horizontal mobile)
    if (this.settings.navigationType === 'arrows') {
      this.prevButton?.addEventListener('click', () => this.goPrev());
      this.nextButton?.addEventListener('click', () => this.goNext());
      
      requestAnimationFrame(() => this.goToIndex(0));
      
      // For arrow mode, only need resize handler (unless vertical mobile)
      let resizeTimeout;
      this.boundHandleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          const currentIsMobile = window.innerWidth <= 767;
          const currentIsVertical = currentIsMobile && this.settings.mobileLayout === 'vertical';
          
          this.calculateDimensions();
          
          if (currentIsVertical) {
            this.updateTimeline();
          } else {
            this.goToIndex(this.currentIndex);
          }
        }, 100);
      };
      window.addEventListener('resize', this.boundHandleResize, { passive: true });
      
      // Also need scroll handler for vertical mobile layout
      if (this.settings.mobileLayout === 'vertical') {
        let ticking = false;
        this.boundHandleScroll = () => {
          if (!ticking) {
            requestAnimationFrame(() => {
              const currentIsMobile = window.innerWidth <= 767;
              const currentIsVertical = currentIsMobile && this.settings.mobileLayout === 'vertical';
              
              if (currentIsVertical) {
                this.updateTimeline();
              }
              ticking = false;
            });
            ticking = true;
          }
        };
        window.addEventListener('scroll', this.boundHandleScroll, { passive: true });
      }
      return;
    }

    // Scroll navigation mode (default) - works on all layouts
    let ticking = false;
    this.boundHandleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.updateTimeline();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Debounced resize handler
    let resizeTimeout;
    this.boundHandleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.calculateDimensions();
        this.updateTimeline();
      }, 100);
    };

    window.addEventListener('scroll', this.boundHandleScroll, { passive: true });
    window.addEventListener('resize', this.boundHandleResize, { passive: true });

    // Also observe for size changes
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.calculateDimensions();
        this.updateTimeline();
      });
      const itemsTrack = this.el.querySelector('.wm-timeline-items-track');
      if (itemsTrack) {
        this.resizeObserver.observe(itemsTrack);
      }
    }

    // Initial update
    requestAnimationFrame(() => {
      this.updateTimeline();
    });
  }

  destroy() {
    // Remove event listeners
    if (this.boundHandleScroll) {
      window.removeEventListener('scroll', this.boundHandleScroll);
    }
    if (this.boundHandleResize) {
      window.removeEventListener('resize', this.boundHandleResize);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
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

    // Clear references
    this.timelineWrapper = null;
    this.progressFill = null;
    this.itemsTrack = null;
    this.dots = [];

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

