// Main Application Script

export function setupCounter(element, valueElement, resetElement) {
  let counter = 0;
  
  const setCounter = (count) => {
    counter = count;
    valueElement.innerHTML = `${counter}`;
    
    // Quick micro-animation on count update
    valueElement.style.transform = 'scale(1.25)';
    setTimeout(() => {
      valueElement.style.transform = 'scale(1)';
    }, 150);
  };

  element.addEventListener('click', () => setCounter(counter + 1));
  
  if (resetElement) {
    resetElement.addEventListener('click', () => setCounter(0));
  }
  
  setCounter(0);
}

document.addEventListener('DOMContentLoaded', () => {
  const counterBtn = document.querySelector('#counter-btn');
  const countValue = document.querySelector('#count-value');
  const resetBtn = document.querySelector('#reset-btn');

  if (counterBtn && countValue) {
    setupCounter(counterBtn, countValue, resetBtn);
  }
});
