const cartCountElement = document.querySelector("#cartCount");
const filterButtons = document.querySelectorAll("[data-filter]");
const products = document.querySelectorAll(".product");
const addButtons = document.querySelectorAll("[data-add]");

let cartCount = 0;

function updateCart() {
  cartCountElement.textContent = cartCount;
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;

    filterButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");

    products.forEach((product) => {
      const shouldShow = filter === "all" || product.dataset.category === filter;
      product.classList.toggle("is-hidden", !shouldShow);
    });
  });
});

addButtons.forEach((button) => {
  button.addEventListener("click", () => {
    cartCount += 1;
    updateCart();
    button.textContent = "Added";

    window.setTimeout(() => {
      button.textContent = "Add";
    }, 900);
  });
});

updateCart();
