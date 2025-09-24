import "~/styles.css";
import { renderStudio } from "~/renderStudio";
import agentviewConfig from "./agentview.config"

renderStudio(
    document.getElementById("agentview"), 
    agentviewConfig
);