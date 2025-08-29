import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import { ProvinciaProvider } from "./context/ProvinciaContext";

ReactDOM.createRoot(document.getElementById("root")).render(
  <ProvinciaProvider>
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
  </ProvinciaProvider>
);