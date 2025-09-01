

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ProvinciaProvider } from "./context/ProvinciaContext";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ProvinciaProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ProvinciaProvider>
  </React.StrictMode>
);
